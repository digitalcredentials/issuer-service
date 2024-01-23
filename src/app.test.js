import { driver } from '@digitalcredentials/did-method-key'
import { decodeSecretKeySeed } from '@digitalcredentials/bnid'
import { expect } from 'chai'
import request from 'supertest'
import { resetConfig } from './config.js'
import {
  ed25519_2020suiteContext,
  getCredentialStatus,
  getUnsignedVC,
  getUnsignedVCWithStatus,
  getUnsignedVCWithoutSuiteContext
} from './test-fixtures/vc.js'

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

import { build } from './app.js'

const didKeyDriver = driver()

let testDIDSeed
let didDocument
let verificationMethod
let signingDID
let app

describe('api', () => {
  before(async () => {
    testDIDSeed = await decodeSeed(process.env.TENANT_SEED_TESTING)
    didDocument = (await didKeyDriver.generate({ seed: testDIDSeed }))
      .didDocument
    verificationMethod = didKeyDriver.publicMethodFor({
      didDocument,
      purpose: 'assertionMethod'
    }).id
    signingDID = didDocument.id
  })

  after(() => {})

  beforeEach(async () => {
    app = await build()
  })

  afterEach(async () => {})

  describe('GET /', () => {
    it('GET / => hello', (done) => {
      request(app)
        .get('/')
        .expect(200)
        .expect('Content-Type', /json/)
        .expect(/{"message":"signing-service server status: ok."}/, done)
    })
  })

  describe('GET /unknown', () => {
    it('unknown endpoint returns 404', (done) => {
      request(app).get('/unknown').expect(404, done)
    }, 10000)
  })

  describe('POST /instance/:instanceId/credentials/sign', () => {
    it('returns 400 if no body', (done) => {
      request(app)
        .post('/instance/testing/credentials/sign')
        .expect('Content-Type', /json/)
        .expect(400, done)
    })

    it('returns 404 if no seed for tenant name', async () => {
      const unSignedVC = getUnsignedVC()
      const response = await request(app)
        .post('/instance/wrongTenantName/credentials/sign')
        .send(unSignedVC)

      expect(response.header['content-type']).to.have.string('json')
      expect(response.status).to.eql(404)
    })

    it('returns the submitted vc, signed with test key', async () => {
      const sentCred = getUnsignedVCWithStatus()
      const response = await request(app)
        .post('/instance/testing/credentials/sign')
        .send(sentCred)

      expect(response.header['content-type']).to.have.string('json')
      expect(response.status).to.eql(200)

      const returnedCred = JSON.parse(JSON.stringify(response.body))
      const proof = returnedCred.proof
      delete returnedCred.proof
      sentCred.issuer.id = signingDID
      expect(sentCred).to.eql(returnedCred)
      expect(proof.type).to.eql('Ed25519Signature2020')
      expect(proof.verificationMethod).to.eql(verificationMethod)
    })

    it('sets the issuer.id to signing DID', (done) => {
      request(app)
        .post('/instance/testing/credentials/sign')
        .send(getUnsignedVCWithStatus())
        .expect('Content-Type', /json/)
        .expect((res) => expect(res.body.issuer.id).to.eql(signingDID))
        .expect(200, done)
    })

    it('adds the suite context', async () => {
      const response = await request(app)
        .post('/instance/testing/credentials/sign')
        .send(getUnsignedVCWithoutSuiteContext())

      expect(response.header['content-type']).to.have.string('json')
      expect(response.status).to.eql(200)

      expect(response.body['@context']).to.include(ed25519_2020suiteContext)
    })

    it('leaves an existing credential status as-is', async () => {
      const statusBeforeSigning = getCredentialStatus()
      const response = await request(app)
        .post('/instance/testing/credentials/sign')
        .send(getUnsignedVCWithStatus())

      expect(response.header['content-type']).to.have.string('json')
      expect(response.status).to.eql(200)
      expect(response.body.credentialStatus).to.eql(statusBeforeSigning)
    })
  })
  describe('DID:web', () => {
    const tenantName = 'apptest'

    before(() => {
      resetConfig()
      process.env[`TENANT_SEED_${tenantName}`] =
        'z1AeiPT496wWmo9BG2QYXeTusgFSZPNG3T9wNeTtjrQ3rCB'
      process.env[`TENANT_DIDMETHOD_${tenantName}`] = 'web'
      process.env[`TENANT_DID_URL_${tenantName}`] = 'https://example.com'
    })

    after(() => {
      delete process.env[`TENANT_SEED_${tenantName}`]
      delete process.env[`TENANT_DIDMETHOD_${tenantName}`]
      delete process.env[`TENANT_DID_URL_${tenantName}`]
    })

    it('signs with a did:web', async () => {
      await request(app)
        .post(`/instance/${tenantName}/credentials/sign`)
        .send(getUnsignedVCWithStatus())
        .expect('Content-Type', /json/)
        .expect((res) =>
          expect(res.body.issuer.id).to.eql('did:web:example.com')
        )
        .expect(200)
    })
  })
})
