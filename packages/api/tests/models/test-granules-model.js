'use strict';

const test = require('ava');

const { buildS3Uri, s3, recursivelyDeleteS3Bucket } = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');

const { Manager, Granule } = require('../../models');

let manager;
test.before(async () => {
  process.env.GranulesTable = randomString();

  manager = new Manager({
    tableName: process.env.GranulesTable,
    tableHash: { name: 'granuleId', type: 'S' }
  });

  await manager.createTable();
});

test.after.always(async () => {
  await manager.deleteTable();
});

test('files existing at location returns empty array if no files exist', async (t) => {
  const filenames = [
    'granule-file-1.hdf',
    'granule-file-2.hdf'
  ];

  const sourceBucket = 'test-bucket';
  const destBucket = 'dest-bucket';

  const sourceFiles = filenames.map((name) => {
    const sourcefilePath = `origin/${name}`;
    return {
      name,
      sourceBucket,
      filepath: sourcefilePath,
      filename: buildS3Uri(sourceBucket, sourcefilePath)
    };
  });

  const destinationFilepath = 'destination';

  const destinations = [
    {
      regex: '.*.hdf$',
      bucket: destBucket,
      filepath: destinationFilepath
    }
  ];

  const granule = {
    files: sourceFiles
  };

  const granulesModel = new Granule();

  const filesExisting = await granulesModel.getFilesExistingAtLocation(granule, destinations);

  t.deepEqual(filesExisting, []);
});

test('files existing at location returns both files if both exist', async (t) => {
  const filenames = [
    'granule-file-1.hdf',
    'granule-file-2.hdf'
  ];

  const sourceBucket = 'test-bucket';
  const destBucket = randomString();

  await s3().createBucket({ Bucket: destBucket }).promise();

  const sourceFiles = filenames.map((name) => ({
    name,
    sourceBucket,
    filepath: name,
    filename: buildS3Uri(sourceBucket, name)
  }));

  const destinations = [
    {
      regex: '.*.hdf$',
      bucket: destBucket
    }
  ];

  const dataSetupPromises = filenames.map(async (filename) => {
    const params = {
      Bucket: destBucket,
      Key: filename,
      Body: 'test'
    };
    return s3().putObject(params).promise();
  });

  await Promise.all(dataSetupPromises);

  const granule = {
    files: sourceFiles
  };

  const granulesModel = new Granule();

  const filesExisting = await granulesModel.getFilesExistingAtLocation(granule, destinations);

  t.deepEqual(filesExisting, sourceFiles);

  await recursivelyDeleteS3Bucket(destBucket);
});

test('files existing at location returns only file that exists', async (t) => {
  const filenames = [
    'granule-file-1.hdf',
    'granule-file-2.hdf'
  ];

  const sourceBucket = 'test-bucket';
  const destBucket = randomString();

  await s3().createBucket({ Bucket: destBucket }).promise();

  const sourceFiles = filenames.map((name) => ({
    name,
    sourceBucket,
    filepath: name,
    filename: buildS3Uri(sourceBucket, name)
  }));

  const destinations = [
    {
      regex: '.*.hdf$',
      bucket: destBucket,
      filepath: ''
    }
  ];

  const params = {
    Bucket: destBucket,
    Key: filenames[1],
    Body: 'test'
  };
  await s3().putObject(params).promise();

  const granule = {
    files: sourceFiles
  };

  const granulesModel = new Granule();

  const filesExisting = await granulesModel.getFilesExistingAtLocation(granule, destinations);

  t.deepEqual(filesExisting, [sourceFiles[1]]);

  await recursivelyDeleteS3Bucket(destBucket);
});

test('files existing at location returns only file that exists with multiple destinations', async (t) => {
  const filenames = [
    'granule-file-1.txt',
    'granule-file-2.hdf'
  ];

  const sourceBucket = 'test-bucket';
  const destBucket1 = randomString();
  const destBucket2 = randomString();

  await Promise.all([
    s3().createBucket({ Bucket: destBucket1 }).promise(),
    s3().createBucket({ Bucket: destBucket2 }).promise()
  ]);

  const sourceFiles = filenames.map((name) => ({
    name,
    sourceBucket,
    filepath: name,
    filename: buildS3Uri(sourceBucket, name)
  }));

  const destinations = [
    {
      regex: '.*.txt$',
      bucket: destBucket1,
      filepath: ''
    },
    {
      regex: '.*.hdf$',
      bucket: destBucket2,
      filepath: ''
    }
  ];

  let params = {
    Bucket: destBucket1,
    Key: filenames[0],
    Body: 'test'
  };
  await s3().putObject(params).promise();

  params = {
    Bucket: destBucket2,
    Key: filenames[1],
    Body: 'test'
  };
  await s3().putObject(params).promise();

  const granule = {
    files: sourceFiles
  };

  const granulesModel = new Granule();

  const filesExisting = await granulesModel.getFilesExistingAtLocation(granule, destinations);

  t.deepEqual(filesExisting, sourceFiles);

  await Promise.all([
    recursivelyDeleteS3Bucket(destBucket1),
    recursivelyDeleteS3Bucket(destBucket2)
  ]);
});
