'use strict';

const aws = require('@cumulus/common/aws');
const testUtils = require('@cumulus/common/test-utils');
const test = require('ava');
const handler = require('../index').handler;

// Create an S3 bucket for each test
test.beforeEach((t) => {
  t.context.bucket = testUtils.randomString(); // eslint-disable-line no-param-reassign
  return aws.s3().createBucket({ Bucket: t.context.bucket }).promise();
});

// Delete the S3 bucket created in setup
test.afterEach.always(async (t) => {
  const response = await aws.s3().listObjects({ Bucket: t.context.bucket }).promise();
  const keys = response.Contents.map((o) => o.Key);
  await Promise.all(keys.map((key) => aws.deleteS3Object(t.context.bucket, key)));

  try {
    await aws.s3().deleteBucket({ Bucket: t.context.bucket }).promise();
  }
  catch (err) {
    if (err.code !== 'NoSuchBucket') throw err;
  }
});

test('Existing PDR is deleted from S3', async (t) => {
  const key = testUtils.randomString();

  // Setup
  await aws.s3().putObject({ Bucket: t.context.bucket, Key: key, Body: 'my-body' }).promise();

  const event = {
    input: {
      Bucket: t.context.bucket,
      Key: key
    },
    config: {}
  };

  return handler(event, {}, async (error) => {
    if (error) return t.fail(error);

    if (await aws.s3ObjectExists({ Bucket: t.context.bucket, Key: key })) {
      return t.fail('S3 object should not exist, but it does.');
    }
    return t.pass();
  });
});

test('A NoSuchBucket error is returned if the bucket does not exist', (t) => {
  const event = {
    input: {
      Bucket: testUtils.randomString(),
      Key: testUtils.randomString()
    },
    config: {}
  };

  return handler(event, {}, (error) => {
    if (error.code === 'NoSuchBucket') return t.pass();
    return t.fail('Expected bucket to not exist');
  });
});

test('No error is returned if the object at the key does not exist', (t) => {
  const event = {
    input: {
      Bucket: t.context.bucket,
      Key: testUtils.randomString()
    },
    config: {}
  };

  return handler(event, {}, (error) => {
    if (error) return t.fail('Object deletion failed');
    return t.pass();
  });
});
