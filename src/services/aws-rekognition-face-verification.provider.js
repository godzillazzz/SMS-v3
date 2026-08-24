'use strict';

const {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
  CompareFacesCommand
} = require('@aws-sdk/client-rekognition');
const HttpError = require('../utils/http-error');

const PROVIDER_NAME = 'AWS_REKOGNITION_POC';
const DEFAULT_REGION = 'ap-southeast-7';
const DEFAULT_CHALLENGE_TYPE = 'FaceMovementAndLightChallenge';
const SUPPORTED_CHALLENGES = new Set(['FaceMovementAndLightChallenge', 'FaceMovementChallenge']);
const SDK_VERSION = '3.1116.0';
const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;

function wipeBytes(value) {
  try { if (value && typeof value.fill === 'function') value.fill(0); } catch {}
}

function unavailable(code = 'VERIFICATION_PROVIDER_UNAVAILABLE') {
  return new HttpError(503, 'Face verification provider is temporarily unavailable.', { code });
}

function invalidResult() {
  return new HttpError(502, 'Face verification provider returned an invalid result.', { code: 'VERIFICATION_PROVIDER_RESULT_INVALID' });
}

function percent(environment, key) {
  const raw = String(environment[key] || '').trim();
  if (!raw) throw unavailable('VERIFICATION_PROVIDER_CONFIGURATION_INCOMPLETE');
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 100) throw unavailable('VERIFICATION_PROVIDER_CONFIGURATION_INCOMPLETE');
  return value;
}

function providerConfig(environment = process.env) {
  if (environment.FACE_VERIFICATION_PROVIDER !== PROVIDER_NAME) throw unavailable('VERIFICATION_PROVIDER_DISABLED');
  const region = String(environment.FACE_VERIFICATION_AWS_REGION || DEFAULT_REGION).trim();
  if (region !== DEFAULT_REGION) throw unavailable('VERIFICATION_PROVIDER_REGION_NOT_ALLOWED');
  const challengeType = String(environment.FACE_LIVENESS_CHALLENGE_TYPE || DEFAULT_CHALLENGE_TYPE).trim();
  if (!SUPPORTED_CHALLENGES.has(challengeType)) throw unavailable('VERIFICATION_PROVIDER_CONFIGURATION_INCOMPLETE');
  const livenessMinConfidence = percent(environment, 'FACE_LIVENESS_MIN_CONFIDENCE');
  const faceMatchMinSimilarity = percent(environment, 'FACE_MATCH_MIN_SIMILARITY');
  return {
    provider: PROVIDER_NAME,
    region,
    challengeType,
    livenessMinConfidence,
    faceMatchMinSimilarity,
    auditImagesLimit: 0,
    policyProfileId: [
      'aws-rekognition-poc',
      region,
      challengeType,
      'audit0',
      'live' + livenessMinConfidence,
      'face' + faceMatchMinSimilarity
    ].join(':'),
    engineVersion: 'aws-sdk-js-v3-' + SDK_VERSION
  };
}

function createAwsRekognitionFaceVerificationProvider({ environment = process.env, client = null, clientFactory = (options) => new RekognitionClient(options) } = {}) {
  function config() { return providerConfig(environment); }
  function awsClient(cfg) { return client || clientFactory({ region: cfg.region }); }

  function publicConfig() {
    try {
      const cfg = config();
      return { configured: true, provider: cfg.provider, region: cfg.region, challengeType: cfg.challengeType };
    } catch {
      return { configured: false, provider: PROVIDER_NAME, region: DEFAULT_REGION, challengeType: DEFAULT_CHALLENGE_TYPE };
    }
  }

  async function createLivenessSession({ clientRequestToken }) {
    const cfg = config();
    const token = String(clientRequestToken || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw new HttpError(400, 'Face verification session identifier is invalid.', { code: 'FACE_VERIFICATION_SESSION_INVALID' });
    try {
      const response = await awsClient(cfg).send(new CreateFaceLivenessSessionCommand({
        ClientRequestToken: token,
        Settings: {
          AuditImagesLimit: 0,
          ChallengePreferences: [{ Type: cfg.challengeType }]
        }
      }));
      if (!response?.SessionId) throw invalidResult();
      return {
        provider: cfg.provider,
        providerSessionRef: String(response.SessionId),
        region: cfg.region,
        challengeType: cfg.challengeType,
        policyProfileId: cfg.policyProfileId,
        engineVersion: cfg.engineVersion
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw unavailable();
    }
  }

  async function evaluate({ providerSessionRef, referencePhotoBytes }) {
    const cfg = config();
    const sessionId = String(providerSessionRef || '').trim();
    if (!sessionId) throw new HttpError(400, 'Provider session is invalid.', { code: 'VERIFICATION_PROVIDER_SESSION_INVALID' });
    if (!Buffer.isBuffer(referencePhotoBytes) || !referencePhotoBytes.length || referencePhotoBytes.length > MAX_REFERENCE_BYTES) throw invalidResult();
    const sdk = awsClient(cfg);
    let result;
    try {
      result = await sdk.send(new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId }));
    } catch {
      throw unavailable();
    }

    const status = String(result?.Status || '').toUpperCase();
    if (status === 'CREATED' || status === 'IN_PROGRESS') {
      return { complete: false, providerStatus: status, policyProfileId: cfg.policyProfileId, engineVersion: cfg.engineVersion };
    }
    if (status && status !== 'SUCCEEDED') {
      return { complete: true, providerStatus: status, padPassed: false, faceMatchPassed: false, injectionRiskDetected: false, resultCode: 'AWS_LIVENESS_' + status, policyProfileId: cfg.policyProfileId, engineVersion: cfg.engineVersion };
    }
    if (status !== 'SUCCEEDED') throw invalidResult();

    const confidence = Number(result?.Confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) throw invalidResult();
    if (confidence < cfg.livenessMinConfidence) {
      if (result?.ReferenceImage) { wipeBytes(result.ReferenceImage.Bytes); result.ReferenceImage.Bytes = undefined; }
      return { complete: true, providerStatus: status, padPassed: false, faceMatchPassed: false, injectionRiskDetected: false, resultCode: 'AWS_LIVENESS_LOW_CONFIDENCE', policyProfileId: cfg.policyProfileId, engineVersion: cfg.engineVersion };
    }

    const providerReferenceBytes = result?.ReferenceImage?.Bytes;
    const liveBytes = Buffer.from(providerReferenceBytes || []);
    wipeBytes(providerReferenceBytes);
    if (result?.ReferenceImage) result.ReferenceImage.Bytes = undefined;
    if (!liveBytes.length || liveBytes.length > MAX_REFERENCE_BYTES) {
      liveBytes.fill(0);
      throw invalidResult();
    }

    try {
      const comparison = await sdk.send(new CompareFacesCommand({
        SourceImage: { Bytes: referencePhotoBytes },
        TargetImage: { Bytes: liveBytes },
        SimilarityThreshold: cfg.faceMatchMinSimilarity
      }));
      const faceMatchPassed = Array.isArray(comparison?.FaceMatches)
        && comparison.FaceMatches.some((item) => Number(item?.Similarity) >= cfg.faceMatchMinSimilarity);
      return {
        complete: true,
        providerStatus: status,
        padPassed: true,
        faceMatchPassed,
        injectionRiskDetected: false,
        resultCode: faceMatchPassed ? 'AWS_VERIFICATION_PASS' : 'AWS_FACE_MATCH_FAILED',
        policyProfileId: cfg.policyProfileId,
        engineVersion: cfg.engineVersion
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw unavailable();
    } finally {
      liveBytes.fill(0);
    }
  }

  return { publicConfig, createLivenessSession, evaluate };
}

module.exports = {
  PROVIDER_NAME,
  DEFAULT_REGION,
  DEFAULT_CHALLENGE_TYPE,
  SDK_VERSION,
  providerConfig,
  createAwsRekognitionFaceVerificationProvider
};
