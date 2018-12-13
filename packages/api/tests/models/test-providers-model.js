'use strict';

const test = require('ava');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const sinon = require('sinon');
const { fakeProviderFactory } = require('../../lib/testUtils.js');
const { fakeRuleFactoryV2 } = require('../../lib/testUtils');
const { Provider, Rule } = require('../../models');
const { AssociatedRulesError } = require('../../lib/errors');
const { RecordDoesNotExist } = require('../../lib/errors');
const Registry = require('../../lib/Registry');


let ruleModel;

test.before(async () => {
  process.env.RulesTable = randomString();
  ruleModel = new Rule();
  await ruleModel.createTable();

  process.env.bucket = randomString();
  await s3().createBucket({ Bucket: process.env.bucket }).promise();
  process.env.stackName = randomString();
});

test.beforeEach(async (t) => {
  t.context.table = Registry.knex()(Provider.tableName);
  t.context.provider = fakeProviderFactory();
});

test.after.always(async () => {
  await ruleModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.bucket);
});

test('get() returns a translated row', async (t) => {
  const id = t.context.provider.id;
  t.context.provider.global_connection_limit = 10;
  await t.context.table.insert(t.context.provider);

  const providersModel = new Provider();
  const actual = (await providersModel.get({ id }));
  t.is(t.context.provider.id, actual.id);
  t.is(t.context.provider.global_connection_limit, actual.globalConnectionLimit);
});

test('get() throws an exception if no record is found', async (t) => {
  const id = t.context.provider.id;
  const providersModel = new Provider();
  let actual;
  try {
    await providersModel.get({ id });
  }
  catch (error) {
    actual = error;
  }
  t.truthy(actual instanceof RecordDoesNotExist);
});

test('exists() returns true when a record exists', async (t) => {
  await t.context.table.insert(t.context.provider);
  const providersModel = new Provider();
  t.true(await providersModel.exists(t.context.provider.id));
});

test('exists() returns false when a record does not exist', async (t) => {
  const providersModel = new Provider();
  t.false(await providersModel.exists(randomString()));
});

test('delete() throws an exception if the provider has associated rules', async (t) => {
  const id = t.context.provider.id;
  const providersModel = new Provider();


  await t.context.table.insert(t.context.provider);
  const rule = fakeRuleFactoryV2({
    provider: id,
    rule: {
      type: 'onetime'
    }
  });

  // The workflow message template must exist in S3 before the rule can be created
  await s3().putObject({
    Bucket: process.env.bucket,
    Key: `${process.env.stackName}/workflows/${rule.workflow}.json`,
    Body: JSON.stringify({})
  }).promise();

  await ruleModel.create(rule);

  try {
    await providersModel.delete({ id });
    t.fail('Expected an exception to be thrown');
  }
  catch (err) {
    t.true(err instanceof AssociatedRulesError);
    t.is(err.message, 'Cannot delete a provider that has associated rules');
    t.deepEqual(err.rules, [rule.name]);
  }
});

test('delete() deletes a provider', async (t) => {
  const id = t.context.provider.id;
  const providersModel = new Provider();
  await t.context.table.insert(t.context.provider);

  await providersModel.delete({ id });

  t.false(await providersModel.exists({ id }));
});

test('insert() inserts a translated provider', async (t) => {
  const provider = t.context.provider;
  const providersModel = new Provider();
  const encryptStub = sinon.stub(providersModel, 'encrypt');
  encryptStub.returns(Promise.resolve('encryptedValue'));

  const updateValues = {
    globalConnectionLimit: 10,
    username: 'foo',
    password: 'bar'
  };
  Object.assign(provider, updateValues);

  await providersModel.insert(provider);

  const actual = { ...(await t.context.table.select().where({ id: provider.id }))[0] };
  const expected = {
    id: provider.id,
    global_connection_limit: 10,
    protocol: provider.protocol,
    host: provider.host,
    created_at: actual.created_at,
    updated_at: actual.updated_at,
    meta: null,
    password: 'encryptedValue',
    port: provider.port,
    username: 'encryptedValue',
    encrypted: true
  };
  t.deepEqual(actual, expected);
});

test('update() updates a record', async (t) => {
  const id = t.context.provider.id;
  const providersModel = new Provider();
  const updateRecord = { host: 'test_host' };

  await t.context.table.insert(t.context.provider);
  await providersModel.update({ id }, updateRecord);

  const actual = (await providersModel.get({ id }));
  t.is('test_host', actual.host);
});
