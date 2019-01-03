'use strict';

const test = require('ava');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const bootstrap = require('../../../lambdas/bootstrap');
const models = require('../../../models');
const rulesEndpoint = require('../../../endpoints/rules');
const {
  createFakeJwtAuthToken,
  testEndpoint
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');
const {
  fakeCollectionFactory,
  fakeProviderFactory,
  fakeRuleFactoryV2
} = require('../../../lib/testUtils');

const esIndex = randomString();

process.env.AccessTokensTable = randomString();
process.env.RulesTable = randomString();
process.env.UsersTable = randomString();
process.env.stackName = randomString();
process.env.bucket = randomString();
process.env.TOKEN_SECRET = randomString();

let accessTokenModel;
let authHeaders;
let collectionModel;
let providerModel;
let ruleModel;
let userModel;

test.before(async () => {
  process.env.internal = process.env.bucket;

  accessTokenModel = new models.AccessToken();
  collectionModel = new models.Collection();
  providerModel = new models.Provider();
  ruleModel = new models.Rule();
  userModel = new models.User();

  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);

  await aws.s3().createBucket({ Bucket: process.env.bucket }).promise();

  await accessTokenModel.createTable();
  await userModel.createTable();

  const jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });
  authHeaders = {
    Authorization: `Bearer ${jwtAuthToken}`
  };
});

test.beforeEach(async (t) => {
  const workflowName = randomString();
  const workflowfile = `${process.env.stackName}/workflows/${workflowName}.json`;

  await aws.s3().putObject({
    Bucket: process.env.bucket,
    Key: workflowfile,
    Body: 'test data'
  }).promise();

  const provider = fakeProviderFactory();
  await providerModel.create(provider);

  const collection = fakeCollectionFactory();
  await collectionModel.create(collection);

  t.context.testRule = fakeRuleFactoryV2({
    collection: {
      name: collection.name,
      version: collection.version
    },
    provider: provider.id,
    workflow: workflowName
  });

  await ruleModel.create(t.context.testRule);
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await ruleModel.deleteTable();
  await userModel.deleteTable();
  await aws.recursivelyDeleteS3Bucket(process.env.bucket);

  const esClient = await Search.es('fakehost');
  await esClient.indices.delete({ index: esIndex });
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {}
  };

  return testEndpoint(rulesEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      name: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(rulesEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 POST with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'POST',
    pathParameters: {
      name: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(rulesEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 PUT with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'PUT',
    pathParameters: {
      name: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(rulesEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 DELETE with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'DELETE',
    pathParameters: {
      name: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(rulesEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-912 GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(rulesEndpoint, request, (response) => {
    assertions.isInvalidAccessTokenResponse(t, response);
  });
});

test('CUMULUS-912 GET with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      name: 'asdf'
    },
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(rulesEndpoint, request, (response) => {
    assertions.isInvalidAccessTokenResponse(t, response);
  });
});

test.todo('CUMULUS-912 GET with an unauthorized user returns an unauthorized response');

test('CUMULUS-912 POST with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'POST',
    pathParameters: {
      name: 'asdf'
    },
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(rulesEndpoint, request, (response) => {
    assertions.isInvalidAccessTokenResponse(t, response);
  });
});

test.todo('CUMULUS-912 POST with pathParameters and with an unauthorized user returns an unauthorized response');

test('CUMULUS-912 PUT with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'PUT',
    pathParameters: {
      name: 'asdf'
    },
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(rulesEndpoint, request, (response) => {
    assertions.isInvalidAccessTokenResponse(t, response);
  });
});

test.todo('CUMULUS-912 PUT with pathParameters and with an unauthorized user returns an unauthorized response');

test('CUMULUS-912 DELETE with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'DELETE',
    pathParameters: {
      name: 'asdf'
    },
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(rulesEndpoint, request, (response) => {
    assertions.isInvalidAccessTokenResponse(t, response);
  });
});

test.todo('CUMULUS-912 DELETE with pathParameters and with an unauthorized user returns an unauthorized response');

// TODO(aimee): Add a rule to ES. List uses ES and we don't have any rules in ES.
test('default returns list of rules', (t) => {
  const listEvent = {
    httpMethod: 'GET',
    headers: authHeaders
  };

  return testEndpoint(rulesEndpoint, listEvent, (response) => {
    const { results } = JSON.parse(response.body);
    t.is(results.length, 0);
  });
});

test('GET gets a rule', (t) => {
  const { testRule } = t.context;

  const getEvent = {
    pathParameters: {
      name: testRule.name
    },
    httpMethod: 'GET',
    headers: authHeaders
  };

  return testEndpoint(rulesEndpoint, getEvent, (response) => {
    const { name } = JSON.parse(response.body);
    t.is(name, testRule.name);
  });
});

test('When calling the API endpoint to delete an existing rule it does not return the deleted rule', async (t) => {
  const { testRule } = t.context;

  const newRule = {
    ...testRule,
    name: randomString()
  };

  const postEvent = {
    httpMethod: 'POST',
    body: JSON.stringify(newRule),
    headers: authHeaders
  };

  await testEndpoint(rulesEndpoint, postEvent, (response) => {
    const { message } = JSON.parse(response.body);
    t.is(message, 'Record saved');
  });

  const deleteEvent = {
    httpMethod: 'DELETE',
    pathParameters: {
      name: newRule.name
    },
    headers: authHeaders
  };

  return testEndpoint(rulesEndpoint, deleteEvent, (response) => {
    const { message, record } = JSON.parse(response.body);
    t.is(message, 'Record deleted');
    t.is(record, undefined);
  });
});

test('403 error when calling the API endpoint to delete an existing rule without an invalid access token', async (t) => {
  const { testRule } = t.context;

  const newRule = {
    ...testRule,
    name: randomString()
  };

  const postEvent = {
    httpMethod: 'POST',
    body: JSON.stringify(newRule),
    headers: authHeaders
  };

  await testEndpoint(rulesEndpoint, postEvent, (response) => {
    const { message, record } = JSON.parse(response.body);

    console.log('response.body:', JSON.stringify(response.body, null, 2));

    t.is(message, 'Record saved');
    newRule.createdAt = record.createdAt;
    newRule.updatedAt = record.updatedAt;
  });

  const deleteEvent = {
    httpMethod: 'DELETE',
    pathParameters: {
      name: newRule.name
    },
    headers: { Authorization: 'Bearer InvalidAuthorizationToken' }
  };

  await testEndpoint(rulesEndpoint, deleteEvent, (response) => {
    assertions.isInvalidAccessTokenResponse(t, response);
  });

  const getEvent = {
    httpMethod: 'GET',
    pathParameters: {
      name: newRule.name
    },
    headers: authHeaders
  };

  return testEndpoint(rulesEndpoint, getEvent, (response) => {
    const record = JSON.parse(response.body);
    t.deepEqual(newRule, record);
  });
});

test('POST creates a rule', (t) => {
  const { testRule } = t.context;

  const newRule = {
    ...testRule,
    name: randomString()
  };

  const postEvent = {
    httpMethod: 'POST',
    body: JSON.stringify(newRule),
    headers: authHeaders
  };

  return testEndpoint(rulesEndpoint, postEvent, (response) => {
    const { message, record } = JSON.parse(response.body);
    t.is(message, 'Record saved');

    newRule.createdAt = record.createdAt;
    newRule.updatedAt = record.updatedAt;

    t.deepEqual(record, newRule);
  });
});

test('POST returns a record exists when one exists', (t) => {
  const { testRule } = t.context;

  const newRule = { ...testRule };

  const postEvent = {
    httpMethod: 'POST',
    body: JSON.stringify(newRule),
    headers: authHeaders
  };

  return testEndpoint(rulesEndpoint, postEvent, (response) => {
    const { message, record } = JSON.parse(response.body);
    t.is(message, `A record already exists for ${newRule.name}`);
    t.falsy(record);
  });
});

test('PUT updates a rule', (t) => {
  const { testRule } = t.context;

  const newRule = {
    ...testRule,
    state: 'ENABLED'
  };

  const updateEvent = {
    body: JSON.stringify({ state: 'ENABLED' }),
    pathParameters: {
      name: testRule.name
    },
    httpMethod: 'PUT',
    headers: authHeaders
  };

  return testEndpoint(rulesEndpoint, updateEvent, (response) => {
    const record = JSON.parse(response.body);
    newRule.createdAt = record.createdAt;
    newRule.updatedAt = record.updatedAt;

    t.deepEqual(record, newRule);
  });
});

test('PUT returns "record does not exist"', (t) => {
  const updateEvent = {
    body: JSON.stringify({ state: 'ENABLED' }),
    pathParameters: {
      name: 'new_make_coffee'
    },
    httpMethod: 'PUT',
    headers: authHeaders
  };

  return testEndpoint(rulesEndpoint, updateEvent, (response) => {
    const { message, record } = JSON.parse(response.body);
    t.is(message, 'Record does not exist');
    t.falsy(record);
  });
});

test('DELETE deletes a rule', (t) => {
  const { testRule } = t.context;

  const deleteEvent = {
    pathParameters: {
      name: testRule.name
    },
    httpMethod: 'DELETE',
    headers: authHeaders
  };

  return testEndpoint(rulesEndpoint, deleteEvent, (response) => {
    const { message } = JSON.parse(response.body);
    t.is(message, 'Record deleted');
  });
});
