'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');

const { User } = require('../../models');

const logsEndpoint = require('../../endpoints/logs');
const {
  testEndpoint
} = require('../../lib/testUtils');
const assertions = require('../../lib/assertions');

let userModel;
test.before(async () => {
  process.env.AccessTokensTable = randomString();
  process.env.UsersTable = randomString();

  userModel = new User();
  await userModel.createTable();
});

test.after.always(async () => {
  await userModel.deleteTable();
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {}
  };

  return testEndpoint(logsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 GET /stats/logs without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    resource: '/stats/logs',
    headers: {}
  };

  return testEndpoint(logsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      executionName: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(logsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-912 GET without pathParameters and an invalid access token returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(logsEndpoint, request, (response) => {
    assertions.isInvalidAccessTokenResponse(t, response);
  });
});

test.todo('CUMULUS-912 GET without pathParameters and an unauthorized user returns an unauthorized response');

test('CUMULUS-912 GET /stats/logs with an invalid access token returns an unauthorized response', (t) => {
  const request = {
    httpMethod: 'GET',
    resource: '/stats/logs',
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(logsEndpoint, request, (response) => {
    assertions.isInvalidAccessTokenResponse(t, response);
  });
});

test('CUMULUS-912 GET with pathParameters and an invalid access token returns an unauthorized response', (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      executionName: 'asdf'
    },
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(logsEndpoint, request, (response) => {
    assertions.isInvalidAccessTokenResponse(t, response);
  });
});
