# G06 AWS Rekognition Preview Credential Gate

Status: credential provisioning blocked until an authenticated AWS account/session is available. No credential value belongs in this file or in Git.

## Purpose

This gate prepares the isolated Preview-only AWS identity boundary required before SMS V3 can make live Rekognition Face Liveness calls. Production remains disabled.

## Required AWS identities

### Backend Preview identity

Attach `infra/aws/g06-face-verification-preview-backend-policy.json` to a temporary/Preview-only role or session used only by the SMS V3 Preview backend. It permits only:

- `rekognition:CreateFaceLivenessSession`
- `rekognition:GetFaceLivenessSessionResults`
- `rekognition:CompareFaces`

The policy is limited by `aws:RequestedRegion = ap-southeast-7`. No S3, KMS, collection/search, IAM or STS action is granted by this policy.

Prefer workload identity or short-lived STS/SSO credentials. Do not create a browser-visible long-lived IAM access key.

### Browser temporary identity

The Amplify FaceLivenessDetector performs `StartFaceLivenessSession` from the client. Browser code therefore needs AWS-authenticated **temporary** credentials. Attach `infra/aws/g06-face-liveness-preview-client-policy.json` to the temporary browser identity (recommended PoC shape: a dedicated Cognito Identity Pool authenticated role). It permits only:

- `rekognition:StartFaceLivenessSession`

and only in `ap-southeast-7`.

No AWS access key/secret/session token may be compiled into Vite source, committed to Git, stored in localStorage, or returned by SMS V3 as a long-lived secret.

## SMS V3 Preview environment contract

Before enabling the PoC route, branch-scoped Preview configuration must include:

- `FACE_VERIFICATION_POC_API_ENABLED=true`
- `FACE_VERIFICATION_PROVIDER=AWS_REKOGNITION_POC`
- `FACE_VERIFICATION_AWS_REGION=ap-southeast-7`
- `FACE_LIVENESS_MIN_CONFIDENCE=<pilot threshold>`
- `FACE_MATCH_MIN_SIMILARITY=<pilot threshold>`

Threshold values are deliberately not chosen by this credential gate; they are tuned during controlled Preview testing. The environment validator rejects incomplete enabled configuration and rejects PoC enablement outside Vercel Preview.

## Live-provider gate

Once an authenticated AWS account/session exists:

1. Create dedicated Preview identities using the two policy files.
2. Verify the effective principal and region without printing secrets.
3. Configure only Preview/branch-scoped SMS V3 environment values and temporary/workload credentials.
4. Keep the PoC endpoint disabled until backend and browser credential smoke tests pass.
5. Enable the PoC endpoint and run one genuine-user liveness session.
6. Immediately verify no audit image/S3 output or biometric media persistence occurred.
7. Only after genuine flow succeeds proceed to separately gated Phase 3B-3 print/screen/video/injection testing.

Production AWS identity/provider configuration is not authorized by this document.
