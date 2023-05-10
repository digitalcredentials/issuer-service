import { driver } from '@digitalcredentials/did-method-key';
import { decodeSecretKeySeed } from '@digitalcredentials/bnid';
import nock from 'nock';
import { expect } from 'chai'
import { dirname } from 'path';
import request from 'supertest';
import { fileURLToPath } from 'url';
import { ed25519_2020suiteContext, getCredentialStatus, getUnsignedVC, getUnsignedVCWithStatus, getUnsignedVCWithoutSuiteContext, statusListContext } from './test-fixtures/vc.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
nock.back.fixtures = __dirname + '/nockBackFixtures'
let saveNockRecording;

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

async function startNockBackRecording(fixtureFileName) {
  nock.back.setMode('record')
  const { nockDone } = await nock.back(
    'nockMocks.json',
    {
      // Don't mock requests made locally
      afterRecord: defs => defs.filter(def => !def.scope.includes("127.0.0.1")),
      // Don't match on the request body because it changes, e.g the timestamp
      before: def => def.filteringRequestBody = (_body, recordedBody) => recordedBody,
      recorder: {
        enable_reqheaders_recording: true
      }
    }
  );
  saveNockRecording = nockDone
  // allow the requests to localhost, i.e, the test calls themselves
  nock.enableNetConnect(/127\.0\.0\.1/);
}

async function stopAndSaveNockRecording() {
  saveNockRecording()
  //nock.back.setMode('wild')
}

import { build } from './app.js';


const didKeyDriver = driver();

let testDIDSeed
let testTenantToken
let testTenantToken2
let didDocument
let verificationMethod
let signingDID
let statusUpdateBody
let app

describe('api', () => {

  before(async () => {
    testDIDSeed = await decodeSeed(process.env.TENANT_SEED_TESTING)
    testTenantToken = process.env.TENANT_TOKEN_TESTING
    testTenantToken2 = process.env.TENANT_TOKEN_TESTING_2

    didDocument = (await didKeyDriver.generate({ seed: testDIDSeed })).didDocument
    verificationMethod = didKeyDriver.publicMethodFor({ didDocument, purpose: 'assertionMethod' }).id
    signingDID = didDocument.id
    statusUpdateBody = { "credentialId": "urn:uuid:951b475e-b795-43bc-ba8f-a2d01efd2eb1", "credentialStatus": [{ "type": "StatusList2021Credential", "status": "revoked" }] }

    startNockBackRecording()
  });

  after(() => {
    stopAndSaveNockRecording()
  })


  beforeEach(async () => {
    app = await build();

  });

  afterEach(async () => {
  });

  describe('GET /', () => {
    it('GET / => hello', done => {
      request(app)
        .get("/")
        .expect(200)
        .expect('Content-Type', /json/)
        .expect(/{"message":"signing-service server status: ok."}/, done);
    });
  })

  describe('GET /unknown', () => {
    it('unknown endpoint returns 404', done => {
      request(app)
        .get("/unknown")
        .expect(404, done)
    }, 10000);
  })

  describe('POST /instance/:instanceId/credentials/issue', () => {

    it('returns 400 if no body', done => {
      request(app)
        .post("/instance/testing/credentials/issue")
        .set('Authorization', `Bearer ${testTenantToken}`)
        .expect('Content-Type', /text/)
        .expect(400, done)
    })

    it('returns 401 if tenant token is missing from auth header', done => {
      request(app)
        .post("/instance/testing/credentials/issue")
        .send(getUnsignedVC())
        .expect('Content-Type', /text/)
        .expect(401, done)
    })

    it('issues credential without auth header when token not set for tenant in config', async () => {
      const response = await request(app)
        .post("/instance/testing3/credentials/issue")
        .send(getUnsignedVC())

      expect(response.header["content-type"]).to.have.string("json");
      expect(response.status).to.eql(200);
      expect(response.body)
    })

    it('returns 403 if token is not valid', done => {
      request(app)
        .post("/instance/testing/credentials/issue")
        .set('Authorization', `Bearer badToken`)
        .send(getUnsignedVC())
        .expect('Content-Type', /text/)
        .expect(403, done)
    })

    it('returns 403 when trying to use token for a different tenant', done => {
      request(app)
        .post("/instance/testing/credentials/issue")
        .set('Authorization', `Bearer ${testTenantToken2}`)
        .send(getUnsignedVC())
        .expect('Content-Type', /text/)
        .expect(403, done)
    })

    it('returns 401 if token is not marked as Bearer', done => {
      request(app)
        .post("/instance/testing/credentials/issue")
        .set('Authorization', `${testTenantToken}`)
        .send(getUnsignedVC())
        .expect('Content-Type', /text/)
        .expect(401, done)
    })

    it('returns 404 if no seed for tenant name', done => {
      request(app)
        .post("/instance/wrongTenantName/credentials/issue")
        .set('Authorization', `${testTenantToken}`)
        .send(getUnsignedVC())
        .expect(404, done)
        .expect('Content-Type', /text/)

    })

    it('returns the submitted vc, signed with test key', async () => {
      const sentCred = getUnsignedVCWithStatus()
      const response = await request(app)
        .post("/instance/testing/credentials/issue")
        .set('Authorization', `Bearer ${testTenantToken}`)
        .send(sentCred)

      expect(response.header["content-type"]).to.have.string("json");
      expect(response.status).to.eql(200);

      const returnedCred = JSON.parse(JSON.stringify(response.body));
      const proof = returnedCred.proof
      delete (returnedCred.proof)
      sentCred.issuer.id = signingDID
      expect(sentCred).to.eql(returnedCred)
      expect(proof.type).to.eql("Ed25519Signature2020");
      expect(proof.verificationMethod).to.eql(verificationMethod)

    });

    it('sets the issuer.id to signing DID', done => {
      request(app)
        .post("/instance/testing/credentials/issue")
        .set('Authorization', `Bearer ${testTenantToken}`)
        .send(getUnsignedVCWithStatus())
        .expect('Content-Type', /json/)
        .expect(res => expect(res.body.issuer.id).to.eql(signingDID))
        .expect(200, done)
    })

    it('adds the suite context', async () => {
      const response = await request(app)
        .post("/instance/testing/credentials/issue")
        .set('Authorization', `Bearer ${testTenantToken}`)
        .send(getUnsignedVCWithoutSuiteContext())

      expect(response.header["content-type"]).to.have.string("json");
      expect(response.status).to.eql(200);

      expect(response.body["@context"]).to.include(ed25519_2020suiteContext)
    })

    it('adds the status list context', async () => {
      const response = await request(app)
        .post("/instance/testing/credentials/issue")
        .set('Authorization', `Bearer ${testTenantToken}`)
        .send(getUnsignedVC())

      expect(response.header["content-type"]).to.have.string("json");
      expect(response.status).to.eql(200);
      expect(response.body["@context"]).to.include(statusListContext)
    })

    it('adds the credential status', async () => {
      const response = await request(app)
        .post("/instance/testing/credentials/issue")
        .set('Authorization', `Bearer ${testTenantToken}`)
        .send(getUnsignedVC())

      expect(response.header["content-type"]).to.have.string("json");
      expect(response.status).to.eql(200);
      expect(response.body.credentialStatus).to.include({
        "type": 'StatusList2021Entry',
        "statusPurpose": "revocation"
      })
      expect(response.body.credentialStatus).to.include({
        "type": 'StatusList2021Entry',
        "statusPurpose": "revocation"
      })
      expect(response.body.credentialStatus).to.include.all.keys(
        "id","statusListIndex","statusListCredential"
      );
    })

    it('leaves an existing credential status as-is', async () => {
      const statusBeforeSigning = getCredentialStatus()
      const response = await request(app)
        .post("/instance/testing/credentials/issue")
        .set('Authorization', `Bearer ${testTenantToken}`)
        .send(getUnsignedVCWithStatus())

      expect(response.header["content-type"]).to.have.string("json");
      expect(response.status).to.eql(200);
      expect(response.body.credentialStatus).to.eql(statusBeforeSigning)
    })




  })

  describe('POST /instance/:instanceId/credentials/status', () => {

    it('returns 400 if no body', done => {
      request(app)
        .post("/instance/testing/credentials/status")
        .set('Authorization', `Bearer ${testTenantToken}`)
        .expect('Content-Type', /text/)
        .expect(400, done)
    })

    it('returns 401 if tenant token is missing from auth header', done => {
      request(app)
        .post("/instance/testing/credentials/status")
        .send(statusUpdateBody)
        .expect('Content-Type', /text/)
        .expect(401, done)
    })

    it('no auth header needed to update status when token not set for tenant in config', done => {
      request(app)
        .post("/instance/testing3/credentials/status")
        .send(statusUpdateBody)
        .expect('Content-Type', /text/)
        .expect(200, done)
    })

    it('returns 403 if token is not valid', done => {
      request(app)
        .post("/instance/testing/credentials/status")
        .set('Authorization', `Bearer ThisIsABadToken`)
        .send(statusUpdateBody)
        .expect('Content-Type', /text/)
        .expect(403, done)
    })

    it('returns 401 if token is not marked as Bearer', done => {
      request(app)
        .post("/instance/testing/credentials/status")
        .set('Authorization', `${testTenantToken}`)
        .send(statusUpdateBody)
        .expect('Content-Type', /text/)
        .expect(401, done)
    })

    it('returns 404 if no seed for tenant name', done => {
      request(app)
        .post("/instance/wrongTenantName/credentials/status")
        .set('Authorization', `${testTenantToken}`)
        .send(statusUpdateBody)
        .expect(404, done)
        .expect('Content-Type', /text/)

    })

    it('returns 403 when trying to use token for a different tenant', done => {
      request(app)
        .post("/instance/testing/credentials/status")
        .set('Authorization', `Bearer ${testTenantToken2}`)
        .send(statusUpdateBody)
        .expect('Content-Type', /text/)
        .expect(403, done)
    })

    it('returns 404 for unknown cred id', done => {
      const statusUpdateBodyWithUnknownId = JSON.parse(JSON.stringify(statusUpdateBody))
      statusUpdateBodyWithUnknownId.credentialId = 'kj09ij'
      request(app)
        .post("/instance/testing/credentials/status")
        .set('Authorization', `Bearer ${testTenantToken}`)
        .send(statusUpdateBodyWithUnknownId)
        .expect('Content-Type', /text/)
        .expect(404, done)
    })
    // AND A TEST FOR THE GENERAL BAD REQUEST THAT DOESN'T FALL INTO THE OTHER CATEGORIES.

    it('calls status manager', async () => {
      const response = await request(app)
        .post("/instance/testing/credentials/status")
        .set('Authorization', `Bearer ${testTenantToken}`)
        .send(statusUpdateBody)

      expect(response.header["content-type"]).to.have.string("text");
      expect(response.status).to.eql(200);
    })

  })
})


