'use strict';

const test = require('ava');
const sinon = require('sinon');
const { randomString } = require('@cumulus/common/test-utils');

const bootstrap = require('../../../lambdas/bootstrap');
const models = require('../../../models');
const providerEndpoint = require('../../../endpoints/providers');
const {
  createFakeJwtAuthToken,
  fakeProviderFactory,
  testEndpoint
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');

process.env.UsersTable = randomString();
process.env.ProvidersTable = randomString();
process.env.stackName = randomString();
process.env.internal = randomString();
process.env.TOKEN_SECRET = randomString();

let providerModel;
const esIndex = randomString();
let esClient;

let authHeaders;
let accessTokenModel;
let userModel;

test.before(async () => {
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);

  providerModel = new models.Provider();
  await providerModel.createTable();

  userModel = new models.User();
  await userModel.createTable();

  process.env.AccessTokensTable = randomString();
  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  const jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });
  authHeaders = {
    Authorization: `Bearer ${jwtAuthToken}`
  };

  esClient = await Search.es('fakehost');
});

test.beforeEach(async (t) => {
  t.context.testProvider = fakeProviderFactory();
  await providerModel.create(t.context.testProvider);
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await providerModel.deleteTable();
  await userModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {}
  };

  return testEndpoint(providerEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-912 GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {
      Authorization: 'Bearer invalid-token'
    }
  };

  return testEndpoint(providerEndpoint, request, (response) => {
    assertions.isInvalidAccessTokenResponse(t, response);
  });
});

test.todo('CUMULUS-912 GET without pathParameters and with an unauthorized user returns an unauthorized response');

test('default returns list of providerModel', (t) => {
  const listEvent = {
    httpMethod: 'GET',
    headers: authHeaders
  };

  const stub = sinon.stub(Search.prototype, 'query').resolves({
    results: [t.context.testProvider]
  });

  return testEndpoint(providerEndpoint, listEvent, (response) => {
    const { results } = JSON.parse(response.body);
    stub.restore();
    t.is(results[0].id, t.context.testProvider.id);
  });
});
