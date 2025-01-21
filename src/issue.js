import { Ed25519Signature2020 } from '@digitalbazaar/ed25519-signature-2020'
import { Ed25519VerificationKey2020 } from '@digitalbazaar/ed25519-verification-key-2020'

import * as Ed25519Multikey from '@digitalbazaar/ed25519-multikey'
import { DataIntegrityProof } from '@digitalbazaar/data-integrity'
import { cryptosuite as eddsaRdfc2022CryptoSuite } from '@digitalbazaar/eddsa-rdfc-2022-cryptosuite'

import { CryptoLD } from 'crypto-ld'
import { driver as keyDriver } from '@digitalbazaar/did-method-key'
import { driver as webDriver } from '@interop/did-web-resolver'
import { securityLoader } from '@digitalcredentials/security-document-loader'
import { getTenantSeed } from './config.js'
import SigningException from './SigningException.js'
import { issue as signVC } from '@digitalbazaar/vc'

let ISSUER_INSTANCES = { eddsa2022: {}, ed25519: {} }
const documentLoader = securityLoader().build()

// Crypto library for linked data
const cryptoLd = new CryptoLD()
cryptoLd.use(Ed25519VerificationKey2020)

// DID drivers
const didWebDriver = webDriver({ cryptoLd })
const didKeyDriver = keyDriver()

didKeyDriver.use({
  multibaseMultikeyHeader: 'z6Mk',
  fromMultibase: Ed25519VerificationKey2020.from
})

/* FOR TESTING */
export const clearIssuerInstances = () => {
  ISSUER_INSTANCES = { eddsa2022: {}, ed25519: {} }
}

const getIssuerInstance = async (instanceId, suite) => {
  if (!ISSUER_INSTANCES[suite][instanceId]) {
    const config = await getTenantSeed(instanceId)
    if (!config?.didSeed)
      throw new SigningException(404, "Tenant doesn't exist.")
    const { didSeed, didMethod, didUrl } = config
    ISSUER_INSTANCES[suite][instanceId] = await buildIssuerInstance(
      didSeed,
      didMethod,
      didUrl,
      suite
    )
  }
  return ISSUER_INSTANCES[suite][instanceId]
}

const issue = async (unsignedVerifiableCredential, instanceId, suiteList) => {
  let credential = unsignedVerifiableCredential
  let issuerIdAdded = false

  for (const signingSuite of suiteList) {
    const {
      issuerInstance,
      didDocument: { id: issuerId }
    } = await getIssuerInstance(instanceId, signingSuite)

    if (!issuerIdAdded) {
      addIssuerId(credential, issuerId)
      issuerIdAdded = true
    }

    credential = await issuerInstance.issueCredential({
      credential
    })
  }
  return credential
}

const addIssuerId = (credential, issuerId) => {
  if (!credential.issuer) {
    throw new SigningException(
      420,
      'An issuer property, either string or object, must be present.'
    )
  } else if (Array.isArray(credential.issuer)) {
    throw new SigningException(
      420,
      'An issuer property cannot be an Array, only a string or object.'
    )
  } else if (typeof credential.issuer === 'string') {
    credential.issuer = issuerId
  } else if (typeof credential.issuer === 'object') {
    credential.issuer.id = issuerId
  } else {
    throw new SigningException(
      420,
      'The issuer property must be either a string or an object.'
    )
  }
}

const buildIssuerInstance = async (seed, method, url, suite) => {
  const { didDocument, key } = await getSigningMaterial({ seed, method, url })
  if (suite === 'eddsa2022') {
    return await buildEddsa2022IssuerInstance(didDocument, key)
  } else {
    return await buildEd255192020IssuerInstance(didDocument, key)
  }
}

const buildEd255192020IssuerInstance = async (didDocument, key) => {
  const signingSuite = new Ed25519Signature2020({ key })
  const issuerInstance = new IssuerInstance({ documentLoader, signingSuite })
  return { issuerInstance, didDocument }
}

const buildEddsa2022IssuerInstance = async (didDocument, key) => {
  // convert Ed25519VerificationKey2020 key to Ed25519Multikey key
  const ed25519Multikey = await Ed25519Multikey.from(key)
  const signingSuite = new DataIntegrityProof({
    signer: ed25519Multikey.signer(),
    cryptosuite: eddsaRdfc2022CryptoSuite
  })
  const issuerInstance = new IssuerInstance({ documentLoader, signingSuite })
  return { issuerInstance, didDocument }
}

export async function getSigningMaterial({ method, seed, url }) {
  let did, key
  if (method === 'web') {
    did = await didWebDriver.generate({ seed, url })
    key = did.methodFor({ purpose: 'assertionMethod' })
  } else {
    const verificationKeyPair = await Ed25519VerificationKey2020.generate({
      seed
    })
    did = await didKeyDriver.fromKeyPair({ verificationKeyPair })
    const assertionMethod = did.methodFor({ purpose: 'assertionMethod' })
    key = await Ed25519VerificationKey2020.from({
      type: assertionMethod.type,
      controller: assertionMethod.controller,
      id: assertionMethod.id,
      publicKeyMultibase: assertionMethod.publicKeyMultibase,
      privateKeyMultibase: verificationKeyPair.privateKeyMultibase
    })
  }
  return { didDocument: did.didDocument, key }
}

export class IssuerInstance {
  constructor({ documentLoader, signingSuite }) {
    this.documentLoader = documentLoader
    this.signingSuite = signingSuite
  }
  async issueCredential({ credential, options }) {
    // this library attaches the signature on the original object, so make a copy
    const credCopy = JSON.parse(JSON.stringify(credential))
    try {
      return signVC({
        credential: credCopy,
        suite: this.signingSuite,
        documentLoader: this.documentLoader,
        ...options
      })
    } catch (e) {
      console.error(e)
      throw e
    }
  }
}

export default issue
