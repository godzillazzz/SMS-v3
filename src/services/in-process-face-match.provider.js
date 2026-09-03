'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const HttpError = require('../utils/http-error');
const { detectedType } = require('./employee-reference-photo-storage.service');
const {
  ACTIVE_FACE_CHALLENGE_VERSION,
  ACTIVE_FACE_CHALLENGE_FRAME_COUNT,
  ACTIVE_FACE_CHALLENGE_CODES
} = require('./active-face-challenge.service');

const PROVIDER_NAME = 'IN_PROCESS_FACE_MATCH_V1';
const VERIFICATION_MODE = 'FACE_MATCH_ONLY';
const POLICY_PROFILE_ID = 'FACE_MATCH_ONLY_ACTIVE_CHALLENGE_IN_PROCESS_V1';
const ENGINE_VERSION = 'human-3.3.6+hse-faceres-mobilenet+blazeface+facemesh:wasm:v1';
const MAX_LIVE_PHOTO_SIZE = 2 * 1024 * 1024;
const MAX_CHALLENGE_FRAME_SIZE = 1024 * 1024;
const MAX_REFERENCE_PHOTO_SIZE = 4 * 1024 * 1024;
const DEFAULT_SIMILARITY_THRESHOLD = 0.62;
const DEFAULT_CHALLENGE_MOVEMENT_RADIANS = 0.17;
const DEFAULT_NEUTRAL_MAX_RADIANS = 0.30;
const REQUIRED_MOVEMENT_FRAMES = 2;

const MATCH_DIAGNOSTIC_BANDS = Object.freeze({
  PASS: 'PASS',
  NEAR_THRESHOLD: 'NEAR_THRESHOLD',
  BELOW_THRESHOLD: 'BELOW_THRESHOLD',
  FAR_BELOW_THRESHOLD: 'FAR_BELOW_THRESHOLD'
});

function faceMatchDiagnosticBand(similarity, threshold) {
  if (!Number.isFinite(similarity) || !Number.isFinite(threshold)) return null;
  if (similarity >= threshold) return MATCH_DIAGNOSTIC_BANDS.PASS;
  if (similarity >= Math.max(0, threshold - 0.05)) return MATCH_DIAGNOSTIC_BANDS.NEAR_THRESHOLD;
  if (similarity >= Math.max(0, threshold - 0.15)) return MATCH_DIAGNOSTIC_BANDS.BELOW_THRESHOLD;
  return MATCH_DIAGNOSTIC_BANDS.FAR_BELOW_THRESHOLD;
}

let runtimePromise = null;
let inferenceTail = Promise.resolve();
let localModelFetchInstalled = false;

function http(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function finiteNumber(value, fallback, { min, max }) {
  if (value == null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw http(503, 'VERIFICATION_PROVIDER_UNAVAILABLE', 'In-process face verifier configuration is invalid.');
  }
  return parsed;
}

function inProcessFaceConfig(environment = process.env) {
  return Object.freeze({
    enabled: environment.FACE_VERIFICATION_IN_PROCESS_ENABLED === 'true',
    similarityThreshold: finiteNumber(environment.FACE_MATCH_SIMILARITY_THRESHOLD, DEFAULT_SIMILARITY_THRESHOLD, { min: 0.55, max: 0.90 }),
    challengeMovementRadians: finiteNumber(environment.FACE_CHALLENGE_MOVEMENT_RADIANS, DEFAULT_CHALLENGE_MOVEMENT_RADIANS, { min: 0.10, max: 0.50 }),
    neutralMaxRadians: finiteNumber(environment.FACE_CHALLENGE_NEUTRAL_MAX_RADIANS, DEFAULT_NEUTRAL_MAX_RADIANS, { min: 0.10, max: 0.50 })
  });
}

function validateImageBytes(buffer, maxBytes, code) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 64 || buffer.length > maxBytes || !detectedType(buffer)) {
    throw http(400, code, 'Face verification image is invalid.');
  }
  return buffer;
}

function validateActiveChallenge(activeChallenge, challengeFrameBytes) {
  if (!activeChallenge
    || activeChallenge.version !== ACTIVE_FACE_CHALLENGE_VERSION
    || !ACTIVE_FACE_CHALLENGE_CODES.includes(activeChallenge.code)
    || activeChallenge.frameCount !== ACTIVE_FACE_CHALLENGE_FRAME_COUNT) {
    throw http(400, 'ACTIVE_CHALLENGE_INVALID', 'Active face challenge metadata is invalid.');
  }
  if (!Array.isArray(challengeFrameBytes) || challengeFrameBytes.length !== ACTIVE_FACE_CHALLENGE_FRAME_COUNT) {
    throw http(400, 'ACTIVE_CHALLENGE_FRAMES_INVALID', 'Active face challenge frames are incomplete.');
  }
  return challengeFrameBytes.map((frame) => validateImageBytes(frame, MAX_CHALLENGE_FRAME_SIZE, 'ACTIVE_CHALLENGE_FRAME_INVALID'));
}

function challengeRule(code) {
  if (code === 'TURN_LEFT') return { axis: 'yaw', sign: 1 };
  if (code === 'TURN_RIGHT') return { axis: 'yaw', sign: -1 };
  if (code === 'LOOK_UP') return { axis: 'pitch', sign: -1 };
  if (code === 'LOOK_DOWN') return { axis: 'pitch', sign: 1 };
  return null;
}

function validPose(pose) {
  return pose
    && Number.isFinite(pose.yaw)
    && Number.isFinite(pose.pitch)
    && Number.isFinite(pose.roll);
}

function evaluateActiveChallengeResult(code, framePoses, finalPose, config) {
  const rule = challengeRule(code);
  if (!rule || !Array.isArray(framePoses) || framePoses.length !== ACTIVE_FACE_CHALLENGE_FRAME_COUNT || !validPose(finalPose) || framePoses.some((pose) => !validPose(pose))) {
    return Object.freeze({ passed: false, resultCode: 'ACTIVE_CHALLENGE_POSE_INVALID' });
  }
  const baselinePose = framePoses[0];
  if (Math.abs(baselinePose.yaw) > config.neutralMaxRadians || Math.abs(baselinePose.pitch) > config.neutralMaxRadians) {
    return Object.freeze({ passed: false, resultCode: 'ACTIVE_CHALLENGE_BASELINE_NOT_NEUTRAL' });
  }
  if (Math.abs(finalPose.yaw) > config.neutralMaxRadians || Math.abs(finalPose.pitch) > config.neutralMaxRadians) {
    return Object.freeze({ passed: false, resultCode: 'ACTIVE_CHALLENGE_FINAL_NOT_NEUTRAL' });
  }
  const baselineAxis = baselinePose[rule.axis];
  const movementPoses = framePoses.slice(1);
  const directionalMovement = movementPoses.map((pose) => rule.sign * (pose[rule.axis] - baselineAxis));
  const requestedDirectionFrames = directionalMovement.filter((value) => value >= config.challengeMovementRadians).length;
  if (requestedDirectionFrames >= REQUIRED_MOVEMENT_FRAMES) {
    return Object.freeze({ passed: true, resultCode: 'ACTIVE_CHALLENGE_PASSED' });
  }
  const oppositeDirectionFrames = directionalMovement.filter((value) => value <= -config.challengeMovementRadians).length;
  if (oppositeDirectionFrames >= REQUIRED_MOVEMENT_FRAMES) {
    return Object.freeze({ passed: false, resultCode: 'ACTIVE_CHALLENGE_WRONG_DIRECTION' });
  }
  return Object.freeze({ passed: false, resultCode: 'ACTIVE_CHALLENGE_INSUFFICIENT_MOVEMENT' });
}

function evaluateActiveChallenge(code, framePoses, finalPose, config) {
  return evaluateActiveChallengeResult(code, framePoses, finalPose, config).passed;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function installLocalModelFetch(modelDir) {
  if (localModelFetchInstalled) return;
  const delegatedFetch = globalThis.fetch;
  if (typeof delegatedFetch !== 'function') throw http(503, 'VERIFICATION_PROVIDER_UNAVAILABLE', 'Runtime fetch support is unavailable.');
  const root = path.resolve(modelDir);
  globalThis.fetch = async (input, init) => {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    if (!raw || !raw.startsWith('file://')) return delegatedFetch(input, init);
    let candidate;
    try { candidate = path.resolve(fileURLToPath(raw)); } catch { return new Response('not found', { status: 404 }); }
    if (!isWithin(root, candidate)) return delegatedFetch(input, init);
    try {
      const body = await fs.promises.readFile(candidate);
      return new Response(body, {
        status: 200,
        headers: { 'content-type': candidate.endsWith('.json') ? 'application/json' : 'application/octet-stream' }
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  };
  localModelFetchInstalled = true;
}

const SAFE_RUNTIME_STAGES = Object.freeze([
  'SHARP_LOAD',
  'WASM_MODULE_LOAD',
  'TFJS_CORE_LOAD',
  'TFJS_CONVERTER_LOAD',
  'PACKAGE_PATHS',
  'WASM_CONFIG',
  'MODEL_FETCH_ADAPTER',
  'HUMAN_MODULE_LOAD',
  'HUMAN_CONSTRUCT',
  'HUMAN_MODEL_LOAD'
]);

async function runtimeStage(stage, operation) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof HttpError && error?.details?.code === 'VERIFICATION_PROVIDER_UNAVAILABLE') {
      error.details = { ...error.details, runtimeStage: SAFE_RUNTIME_STAGES.includes(error.details?.runtimeStage) ? error.details.runtimeStage : stage };
      throw error;
    }
    const wrapped = http(503, 'VERIFICATION_PROVIDER_UNAVAILABLE', 'In-process face verifier is unavailable.');
    wrapped.details = { ...wrapped.details, runtimeStage: stage };
    throw wrapped;
  }
}

function packagePaths() {
  const humanNodeEntry = require.resolve('@vladmandic/human');
  const humanDistDir = path.dirname(humanNodeEntry);
  const humanRoot = path.dirname(humanDistDir);
  const humanWasmEntry = path.join(humanDistDir, 'human.node-wasm.js');
  const modelDir = path.join(humanRoot, 'models');
  const wasmEntry = require.resolve('@tensorflow/tfjs-backend-wasm');
  const wasmDistDir = path.dirname(wasmEntry);
  return { humanWasmEntry, modelDir, wasmDistDir };
}

async function buildHumanRuntime() {
  const sharp = await runtimeStage('SHARP_LOAD', async () => require('sharp'));
  const wasm = await runtimeStage('WASM_MODULE_LOAD', async () => require('@tensorflow/tfjs-backend-wasm'));
  await runtimeStage('TFJS_CORE_LOAD', async () => require('@tensorflow/tfjs-core'));
  await runtimeStage('TFJS_CONVERTER_LOAD', async () => require('@tensorflow/tfjs-converter'));
  const { humanWasmEntry, modelDir, wasmDistDir } = await runtimeStage('PACKAGE_PATHS', async () => packagePaths());
  await runtimeStage('WASM_CONFIG', async () => wasm.setWasmPaths({
    'tfjs-backend-wasm.wasm': path.join(wasmDistDir, 'tfjs-backend-wasm.wasm'),
    'tfjs-backend-wasm-simd.wasm': path.join(wasmDistDir, 'tfjs-backend-wasm-simd.wasm'),
    'tfjs-backend-wasm-threaded-simd.wasm': path.join(wasmDistDir, 'tfjs-backend-wasm-threaded-simd.wasm')
  }));
  await runtimeStage('MODEL_FETCH_ADAPTER', async () => installLocalModelFetch(modelDir));
  const HumanModule = await runtimeStage('HUMAN_MODULE_LOAD', async () => require(humanWasmEntry));
  const Human = HumanModule.default || HumanModule.Human || HumanModule;
  const human = await runtimeStage('HUMAN_CONSTRUCT', async () => new Human({
    backend: 'wasm',
    modelBasePath: pathToFileURL(`${modelDir}${path.sep}`).href,
    cacheSensitivity: 0,
    filter: { enabled: false },
    face: {
      enabled: true,
      detector: { enabled: true, rotation: true, return: false, maxDetected: 2, minConfidence: 0.60 },
      mesh: { enabled: true },
      description: { enabled: true },
      iris: { enabled: false },
      emotion: { enabled: false },
      antispoof: { enabled: false },
      liveness: { enabled: false }
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: false }
  }));
  await runtimeStage('HUMAN_MODEL_LOAD', async () => human.load());

  async function detect(buffer, code) {
    let tensor;
    try {
      const { data, info } = await sharp(buffer)
        .rotate()
        .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (info.channels !== 3 || info.width < 96 || info.height < 96) throw new Error('decoded image is invalid');
      tensor = human.tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32');
      const result = await human.detect(tensor);
      if (!Array.isArray(result.face) || result.face.length !== 1) throw new Error('exactly one face is required');
      const face = result.face[0];
      const embedding = Array.isArray(face.embedding) ? face.embedding : null;
      const angle = face.rotation?.angle;
      const box = Array.isArray(face.box) ? face.box : null;
      if (!embedding || embedding.length < 256 || !validPose(angle) || !box || box.length < 4) throw new Error('face result is incomplete');
      const areaFraction = Math.max(0, Number(box[2]) * Number(box[3])) / (info.width * info.height);
      if (!Number.isFinite(areaFraction) || areaFraction < 0.035 || areaFraction > 0.92) throw new Error('face size is unsuitable');
      return Object.freeze({
        embedding: Object.freeze(embedding.map((value) => Number(value))),
        pose: Object.freeze({ yaw: Number(angle.yaw), pitch: Number(angle.pitch), roll: Number(angle.roll) })
      });
    } catch {
      throw http(400, code, 'Face verification image could not be evaluated.');
    } finally {
      if (tensor && typeof tensor.dispose === 'function') tensor.dispose();
    }
  }

  return Object.freeze({
    async observe(buffer, code) {
      const previous = inferenceTail;
      let release;
      inferenceTail = new Promise((resolve) => { release = resolve; });
      await previous.catch(() => {});
      try { return await detect(buffer, code); } finally { release(); }
    },
    similarity(left, right) {
      const value = human.match?.similarity
        ? human.match.similarity(left, right)
        : human.similarity(left, right);
      if (!Number.isFinite(value)) throw http(503, 'VERIFICATION_PROVIDER_UNAVAILABLE', 'Face similarity runtime returned an invalid result.');
      return Number(value);
    }
  });
}

async function defaultRuntime() {
  if (!runtimePromise) {
    runtimePromise = buildHumanRuntime().catch((error) => {
      runtimePromise = null;
      if (error instanceof HttpError) throw error;
      throw http(503, 'VERIFICATION_PROVIDER_UNAVAILABLE', 'In-process face verifier is unavailable.');
    });
  }
  return runtimePromise;
}

function createInProcessFaceMatchProvider({ environment = process.env, runtime = null } = {}) {
  const config = inProcessFaceConfig(environment);
  return Object.freeze({
    name: PROVIDER_NAME,
    verificationMode: VERIFICATION_MODE,
    policyProfileId: POLICY_PROFILE_ID,
    engineVersion: ENGINE_VERSION,
    publicConfig() {
      return Object.freeze({ provider: PROVIDER_NAME, verificationMode: VERIFICATION_MODE, storesLivePhoto: false, activeChallengeVersion: ACTIVE_FACE_CHALLENGE_VERSION });
    },
    async assessReferencePhoto({ referencePhotoBytes }) {
      if (!config.enabled) throw http(503, 'VERIFICATION_PROVIDER_UNAVAILABLE', 'In-process face verifier is not enabled.');
      const reference = validateImageBytes(referencePhotoBytes, MAX_REFERENCE_PHOTO_SIZE, 'FACE_REFERENCE_INVALID');
      const engine = runtime || await defaultRuntime();
      let observation;
      try { observation = await engine.observe(reference, 'FACE_REFERENCE_INVALID'); }
      catch (error) {
        if (error?.details?.code === 'VERIFICATION_PROVIDER_UNAVAILABLE') throw error;
        return Object.freeze({ accepted: false, resultCode: 'FACE_REFERENCE_INVALID' });
      }
      const neutral = Math.abs(observation.pose.yaw) <= config.neutralMaxRadians && Math.abs(observation.pose.pitch) <= config.neutralMaxRadians;
      return Object.freeze({ accepted: neutral, resultCode: neutral ? 'FACE_REFERENCE_VALID' : 'FACE_REFERENCE_NOT_NEUTRAL' });
    },
    async evaluate({ providerSessionRef, activeChallenge, challengeFrameBytes, livePhotoBytes, referencePhotoBytes }) {
      if (!config.enabled) throw http(503, 'VERIFICATION_PROVIDER_UNAVAILABLE', 'In-process face verifier is not enabled.');
      const sessionRef = String(providerSessionRef || '').trim();
      if (!sessionRef) throw http(400, 'VERIFICATION_PROVIDER_SESSION_INVALID', 'Provider session metadata is required.');
      const challengeFrames = validateActiveChallenge(activeChallenge, challengeFrameBytes);
      const live = validateImageBytes(livePhotoBytes, MAX_LIVE_PHOTO_SIZE, 'LIVE_FACE_PHOTO_INVALID');
      const reference = validateImageBytes(referencePhotoBytes, MAX_REFERENCE_PHOTO_SIZE, 'FACE_REFERENCE_INVALID');
      const engine = runtime || await defaultRuntime();

      let frameObservations;
      let liveObservation;
      try {
        frameObservations = [];
        for (const frame of challengeFrames) frameObservations.push(await engine.observe(frame, 'ACTIVE_CHALLENGE_FRAME_INVALID'));
        liveObservation = await engine.observe(live, 'LIVE_FACE_PHOTO_INVALID');
      } catch (error) {
        if (error?.details?.code === 'VERIFICATION_PROVIDER_UNAVAILABLE') throw error;
        return Object.freeze({
          activeChallengePassed: false,
          faceMatchPassed: false,
          resultCode: 'ACTIVE_CHALLENGE_FRAME_EVALUATION_FAILED',
          policyProfileId: POLICY_PROFILE_ID,
          engineVersion: ENGINE_VERSION,
          providerSessionRef: sessionRef
        });
      }

      const challengeResult = evaluateActiveChallengeResult(
        activeChallenge.code,
        frameObservations.map((observation) => observation.pose),
        liveObservation.pose,
        config
      );
      if (!challengeResult.passed) {
        return Object.freeze({
          activeChallengePassed: false,
          faceMatchPassed: false,
          resultCode: challengeResult.resultCode,
          policyProfileId: POLICY_PROFILE_ID,
          engineVersion: ENGINE_VERSION,
          providerSessionRef: sessionRef
        });
      }

      let referenceObservation;
      try { referenceObservation = await engine.observe(reference, 'FACE_REFERENCE_INVALID'); }
      catch (error) {
        if (error?.details?.code === 'VERIFICATION_PROVIDER_UNAVAILABLE') throw error;
        return Object.freeze({
          activeChallengePassed: true,
          faceMatchPassed: false,
          resultCode: 'FACE_REFERENCE_INVALID',
          policyProfileId: POLICY_PROFILE_ID,
          engineVersion: ENGINE_VERSION,
          providerSessionRef: sessionRef
        });
      }

      const similarity = engine.similarity(liveObservation.embedding, referenceObservation.embedding);
      const matched = similarity >= config.similarityThreshold;
      const diagnosticMatchBand = faceMatchDiagnosticBand(similarity, config.similarityThreshold);
      return Object.freeze({
        activeChallengePassed: true,
        faceMatchPassed: matched,
        resultCode: matched ? 'MATCH' : 'FACE_MATCH_FAILED',
        diagnosticMatchBand,
        policyProfileId: POLICY_PROFILE_ID,
        engineVersion: ENGINE_VERSION,
        providerSessionRef: sessionRef
      });
    }
  });
}

module.exports = {
  PROVIDER_NAME,
  VERIFICATION_MODE,
  POLICY_PROFILE_ID,
  ENGINE_VERSION,
  MAX_LIVE_PHOTO_SIZE,
  MAX_CHALLENGE_FRAME_SIZE,
  MAX_REFERENCE_PHOTO_SIZE,
  DEFAULT_SIMILARITY_THRESHOLD,
  DEFAULT_CHALLENGE_MOVEMENT_RADIANS,
  DEFAULT_NEUTRAL_MAX_RADIANS,
  MATCH_DIAGNOSTIC_BANDS,
  faceMatchDiagnosticBand,
  inProcessFaceConfig,
  validateActiveChallenge,
  evaluateActiveChallenge,
  evaluateActiveChallengeResult,
  createInProcessFaceMatchProvider,
  SAFE_RUNTIME_STAGES
};
