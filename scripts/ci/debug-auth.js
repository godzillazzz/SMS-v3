/**
 * Debug Authentication Logic on Runner
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Load Vercel Env
try {
  const filePath = path.join(__dirname, '../../.vercel/.env.production.local');
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    let loadedCount = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let val = match[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (val) {
          // Prevent overwriting existing critical variables
          if (['DATABASE_URL', 'DIRECT_URL'].includes(key) && process.env[key]) {
            console.log(`Skipped overwriting existing ${key} with Vercel env.`);
            continue;
          }
          process.env[key] = val;
          loadedCount++;
        }
      }
    }
    console.log(`Loaded ${loadedCount} env variables from local Vercel env file.`);
  }
} catch (e) {
  console.log('Failed to read local Vercel env file:', e.message);
}

const env = require('../../src/config/env');
const prisma = require('../../src/config/prisma');
const { accessTokenFor } = require('../../src/services/auth.service');
const jwt = require('jsonwebtoken');

async function debugAuth() {
  try {
    console.log('Config values:');
    console.log('- jwtSecret length:', env.jwtSecret?.length);
    console.log('- jwtAlgorithm:', env.jwtAlgorithm);
    console.log('- jwtIssuer:', env.jwtIssuer);
    console.log('- jwtAudience:', env.jwtAudience);

    // Get Admin User
    const user = await prisma.user.findFirst({
      where: { role: 'ADMIN', isActive: true, accountStatus: 'ACTIVE' }
    });

    if (!user) {
      console.log('No active admin user found in database!');
      return;
    }

    console.log('Found active Admin user:');
    console.log('- id:', user.id);
    console.log('- email:', user.email);
    console.log('- tokenVersion:', user.tokenVersion);

    // Create Access Token
    const token = accessTokenFor(user, { expiresIn: '4h' });
    console.log('Generated token:', token.slice(0, 20) + '...');

    // Verify token locally
    console.log('Attempting local jwt.verify...');
    try {
      const claims = jwt.verify(token, env.jwtSecret, {
        algorithms: [env.jwtAlgorithm],
        issuer: env.jwtIssuer,
        audience: env.jwtAudience
      });
      console.log('✅ Local jwt.verify passed! Claims:', claims);

      // Verify user claims match db
      if (user.tokenVersion !== claims.tokenVersion) {
        console.log('❌ Token version mismatch! DB:', user.tokenVersion, 'Claims:', claims.tokenVersion);
      } else {
        console.log('✅ Token version matched DB!');
      }
    } catch (err) {
      console.log('❌ Local jwt.verify failed! Error:', err.message);
    }

  } catch (e) {
    console.log('Fatal debug error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

debugAuth();
