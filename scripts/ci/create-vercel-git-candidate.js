'use strict';

const deploymentPattern = /^dpl_[A-Za-z0-9]+$/;
const commitPattern = /^[0-9a-f]{40}$/;
const hostPattern = /^https:\/\/sms-v3-staging-[A-Za-z0-9-]+\.vercel\.app\/?$/;
const canonicalHost = 'sms-v3-staging-ten.vercel.app';
const branchAliasPattern = /^sms-v3-staging-git-fix-serverless-database-re-[a-z0-9-]+-godzillazz\.vercel\.app$/;

function assert(condition, message) {
  if (!condition) throw new Error(`Production candidate guard: ${message}`);
}

function getLinkedGitHubRepository(project) {
  const link = project?.link;
  assert(link && link.type === 'github', 'Vercel project is not linked to GitHub');
  const repo = String(link.repo || '').replace(/\.git$/i, '').toLowerCase();
  const org = String(link.org || link.owner || '').toLowerCase();
  const identity = repo.includes('/') ? repo : `${org}/${repo}`;
  assert(identity === 'godzillazzz/sms-v3', 'Vercel project is linked to an unexpected GitHub repository');
  return { org: 'godzillazzz', repo: 'SMS-v3', identity };
}

function aliasHost(alias) {
  if (typeof alias !== 'string' || !alias) return '';
  try {
    return new URL(alias.includes('://') ? alias : `https://${alias}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function assertCandidateRecord(record, expected) {
  assert(record && typeof record === 'object', 'Vercel returned no deployment record');
  assert(deploymentPattern.test(record.id || ''), 'Vercel returned an invalid deployment id');
  assert(record.projectId === expected.projectId, 'candidate project id mismatch');
  assert(record.target === 'production', 'candidate target is not production');
  assert(record.readyState === 'READY', `candidate did not reach READY (state=${record.readyState || 'missing'})`);
  assert(record.meta?.githubCommitSha === expected.commitSha, 'native githubCommitSha mismatch');
  assert(record.meta?.githubCommitRef === expected.commitRef, 'native githubCommitRef mismatch');
  assert(record.gitSource?.type === 'github', 'candidate is not Git-sourced from GitHub');
  assert(String(record.gitSource?.org || '').toLowerCase() === 'godzillazzz', 'native Git source organization mismatch');
  assert(String(record.gitSource?.repo || '').toLowerCase() === 'sms-v3', 'native Git source repository mismatch');
  assert(String(record.gitSource?.sha || '').toLowerCase() === expected.commitSha, 'native Git source SHA mismatch');
  assert(record.gitSource?.ref === expected.commitRef, 'native Git source ref mismatch');
  assert(Array.isArray(record.alias), 'candidate aliases are missing from the Vercel deployment record');
  const aliases = record.alias.map(aliasHost);
  assert(aliases.every(Boolean), 'candidate contains a malformed alias');
  assert(!aliases.includes(canonicalHost), 'candidate was assigned the canonical Production alias');
  assert(aliases.every((host) => branchAliasPattern.test(host)), 'candidate contains an unexpected non-branch alias');
  assert(record.aliasAssigned === true || record.aliasAssigned === 'true' || record.aliasAssigned === false || record.aliasAssigned === 'false', 'candidate alias assignment state is unavailable');
  if (record.aliasAssigned === true || record.aliasAssigned === 'true') {
    assert(aliases.length > 0, 'candidate alias assignment is reported without a branch alias');
  }
  const url = record.url && (record.url.startsWith('http') ? record.url : `https://${record.url}`);
  assert(hostPattern.test(url || ''), 'candidate URL is outside the expected Vercel deployment host pattern');
  return { id: record.id, url, aliases, aliasAssigned: record.aliasAssigned };
}

async function main({ env = process.env, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now } = {}) {
  const token = env.VERCEL_TOKEN;
  const teamId = env.EXPECTED_ORG_ID;
  const projectId = env.EXPECTED_PROJECT_ID;
  const projectName = env.EXPECTED_PROJECT_NAME;
  const commitSha = env.TARGET_SHA;
  const commitRef = env.SOURCE_BRANCH;
  assert(token, 'Vercel API credential is unavailable');
  assert(teamId && projectId && projectName, 'fixed Vercel team/project identity is unavailable');
  assert(commitPattern.test(commitSha || ''), 'release source commit SHA is invalid');
  assert(commitRef === 'fix/serverless-database-reliability', 'release Git ref is outside the approved source branch');

  const query = `teamId=${encodeURIComponent(teamId)}`;
  async function api(pathname, init = {}) {
    let response;
    try {
      response = await fetchImpl(`https://api.vercel.com${pathname}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error(`Vercel API request failed: ${pathname.split('?')[0]}`);
    }
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok) {
      const code = typeof body.error?.code === 'string' ? body.error.code : `HTTP_${response.status}`;
      throw new Error(`Vercel API request rejected: ${pathname.split('?')[0]} (${code})`);
    }
    return body;
  }

  const project = await api(`/v9/projects/${encodeURIComponent(projectId)}?${query}`);
  assert(project.id === projectId, 'Vercel project identity mismatch');
  assert(project.name === projectName, 'Vercel project name mismatch');
  assert(project.autoAssignCustomDomains === false, 'Vercel project must have automatic custom Production domain assignment disabled');
  const linked = getLinkedGitHubRepository(project);

  const requestBody = {
    name: projectName,
    project: projectId,
    target: 'production',
    alias: [],
    gitSource: {
      type: 'github',
      org: linked.org,
      repo: linked.repo,
      ref: commitRef,
      sha: commitSha,
    },
  };
  let record = await api(`/v13/deployments?${query}&forceNew=1&skipAutoDetectionConfirmation=1`, {
    method: 'POST',
    body: JSON.stringify(requestBody),
  });

  const startedAt = now();
  assert(deploymentPattern.test(record.id || ''), 'Vercel candidate creation returned no deployment id');
  const candidateId = record.id;
  while (record.readyState !== 'READY' && record.readyState !== 'ERROR' && now() - startedAt < 20 * 60_000) {
    await sleep(5_000);
    record = await api(`/v13/deployments/${encodeURIComponent(candidateId)}?${query}`);
  }
  if (record.readyState !== 'READY') {
    const detail = record.readyState === 'ERROR' && typeof record.errorCode === 'string' ? record.errorCode : record.readyState || 'timeout';
    throw new Error(`Production candidate did not become READY (${detail})`);
  }

  const candidate = assertCandidateRecord(record, { projectId, commitSha, commitRef });
  process.stdout.write([
    `deployment_id=${candidate.id}`,
    `deployment_url=${candidate.url}`,
    `candidate_project_id=${projectId}`,
    `candidate_commit_sha=${commitSha}`,
    `candidate_commit_ref=${commitRef}`,
    'candidate_target=production',
    `candidate_alias_assigned=${String(candidate.aliasAssigned)}`,
    'candidate_canonical_alias_assigned=false',
    `candidate_alias_count=${candidate.aliases.length}`,
  ].join('\n') + '\n');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { aliasHost, assertCandidateRecord, getLinkedGitHubRepository, main };
