import fs from 'fs/promises';
import { generateSecretKeySeed, decodeSecretKeySeed } from '@digitalcredentials/bnid';

let CONFIG;
let DID_SEED;

export function setConfig() {
  CONFIG = parseConfig();
}

function parseConfig() {
  if (!process.env.PORT) {
    throw new Error('Environment variable "PORT" is not set');
  }

  return Object.freeze({
    enableHttpsForDev: process.env.ENABLE_HTTPS_FOR_DEV?.toLowerCase() === 'true',
    port: parseInt(process.env.PORT),
    credStatusService: process.env.CRED_STATUS_SERVICE,
    credStatusRepoName: process.env.CRED_STATUS_REPO_NAME,
    credStatusMetaRepoName: process.env.CRED_STATUS_META_REPO_NAME,
    credStatusRepoOrgName: process.env.CRED_STATUS_REPO_ORG_NAME,
    credStatusRepoVisibility: process.env.CRED_STATUS_REPO_VISIBILITY,
    credStatusAccessToken: process.env.CRED_STATUS_ACCESS_TOKEN,
    credStatusDidSeed: process.env.CRED_STATUS_DID_SEED
  });
}

export function getConfig() {
  if (!CONFIG) {
    setConfig();
  }
  return CONFIG;
}

export async function getDIDSeed() {
  if (!DID_SEED) {
    if (process.env.DID_SEED) {
      // there's a seed in the .env file, so use that
      DID_SEED = decodeSeed(process.env.DID_SEED);
    } else {
      // no seed in .env, so generate a new seed and save it to .env
      DID_SEED = await setNewRandomDIDSeed()
    }
  }
  return DID_SEED;
}

async function setNewRandomDIDSeed() {
  try {
    const newDidSeed = await generateSecretKeySeed();
    const envEntry = `\nDID_SEED=${newDidSeed}`;
    await fs.appendFile('./.env', envEntry);
  } catch (err) {
    console.log(err);
  }
}

const decodeSeed = async (secretKeySeed) => {
  let secretKeySeedBytes // Uint8Array;
  if (secretKeySeed.startsWith('z')) {
    // This is a multibase-decoded key seed, like those generated by @digitalcredentials/did-cli
    secretKeySeedBytes = decodeSecretKeySeed({ secretKeySeed });
  } else if (secretKeySeed.length >= 32) {
    secretKeySeedBytes = (new TextEncoder()).encode(secretKeySeed).slice(0, 32);
  } else {
    throw TypeError('"secretKeySeed" must be at least 32 bytes, preferably multibase-encoded.');
  }
  return secretKeySeedBytes;
}
