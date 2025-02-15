import { decodeSecretKeySeed } from 'bnid'

const decodeSeed = async (secretKeySeed) => {
  let secretKeySeedBytes // Uint8Array;
  if (secretKeySeed.startsWith('z')) {
    // This is a multibase-decoded key seed, like those generated by @digitalcredentials/did-cli
    secretKeySeedBytes = decodeSecretKeySeed({ secretKeySeed })
  } else if (secretKeySeed.length >= 32) {
    secretKeySeedBytes = new TextEncoder().encode(secretKeySeed).slice(0, 32)
  } else {
    throw TypeError(
      '"secretKeySeed" must be at least 32 bytes, preferably multibase-encoded.'
    )
  }
  return secretKeySeedBytes
}

export default decodeSeed
