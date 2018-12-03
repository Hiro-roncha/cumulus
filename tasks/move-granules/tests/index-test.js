'use strict';

const fs = require('fs');
const path = require('path');
const test = require('ava');
const {
  buildS3Uri,
  listS3ObjectsV2,
  recursivelyDeleteS3Bucket,
  s3ObjectExists,
  s3,
  s3GetObjectTagging,
  promiseS3Upload,
  headObject,
  parseS3Uri
} = require('@cumulus/common/aws');
const clonedeep = require('lodash.clonedeep');
const set = require('lodash.set');
const errors = require('@cumulus/common/errors');
const {
  randomString, validateConfig, validateInput, validateOutput
} = require('@cumulus/common/test-utils');
const { promisify } = require('util');

const { moveGranules } = require('..');

const readFile = promisify(fs.readFile);

async function uploadFiles(files, bucket) {
  await Promise.all(files.map((file) => promiseS3Upload({
    Bucket: bucket,
    Key: parseS3Uri(file).Key,
    Body: file.endsWith('.cmr.xml')
      ? fs.createReadStream('tests/data/meta.xml') : parseS3Uri(file).Key
  })));
}

async function updateFileTags(files, bucket, TagSet) {
  await Promise.all(files.map((file) => s3().putObjectTagging({
    Bucket: bucket,
    Key: parseS3Uri(file).Key,
    Tagging: { TagSet }
  }).promise()));
}

function buildPayload(t) {
  const newPayload = t.context.payload;

  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal.name = t.context.stagingBucket;
  newPayload.config.buckets.public.name = t.context.publicBucket;
  newPayload.config.buckets.protected.name = t.context.protectedBucket;

  newPayload.input = newPayload.input.map((file) =>
    buildS3Uri(`${t.context.stagingBucket}`, parseS3Uri(file).Key));
  newPayload.config.input_granules.forEach((gran) => {
    gran.files.forEach((file) => {
      file.bucket = t.context.stagingBucket;
      file.filename = buildS3Uri(t.context.stagingBucket, parseS3Uri(file.filename).Key);
    });
  });
  return newPayload;
}

function getExpectedOutputFileNames(t) {
  return [
    `s3://${t.context.protectedBucket}/example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf`,
    `s3://${t.context.publicBucket}/jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
    `s3://${t.context.publicBucket}/example/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`,
    `s3://${t.context.publicBucket}/example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml`
  ];
}
/**
 * Get file metadata for a set of files.
 * headObject from localstack doesn't return LastModified with millisecond,
 * use listObjectsV2 instead
 *
 * @param {Array<Object>} files - array of file objects
 * @returns {Promise<Array>} - file detail responses
 */
async function getFilesMetadata(files) {
  const getFileRequests = files.map(async (f) => {
    const s3list = await listS3ObjectsV2(
      { Bucket: f.bucket, Prefix: parseS3Uri(f.filename).Key }
    );
    const s3object = s3list.filter((s3file) => s3file.Key === parseS3Uri(f.filename).Key);

    return {
      filename: f.filename,
      fileSize: s3object[0].Size,
      LastModified: s3object[0].LastModified
    };
  });
  return Promise.all(getFileRequests);
}

test.beforeEach(async (t) => {
  t.context.stagingBucket = randomString();
  t.context.publicBucket = randomString();
  t.context.protectedBucket = randomString();
  await Promise.all([
    s3().createBucket({ Bucket: t.context.stagingBucket }).promise(),
    s3().createBucket({ Bucket: t.context.publicBucket }).promise(),
    s3().createBucket({ Bucket: t.context.protectedBucket }).promise()
  ]);

  const payloadPath = path.join(__dirname, 'data', 'payload.json');
  const rawPayload = await readFile(payloadPath, 'utf8');
  t.context.payload = JSON.parse(rawPayload);
  process.env.REINGEST_GRANULE = false;
});

test.afterEach.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.publicBucket);
  await recursivelyDeleteS3Bucket(t.context.stagingBucket);
  await recursivelyDeleteS3Bucket(t.context.protectedBucket);
});

test.serial('should move files to final location', async (t) => {
  const newPayload = buildPayload(t);
  await uploadFiles(newPayload.input, t.context.stagingBucket);

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);

  const check = await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  });

  t.true(check);
});

test.serial('should move renamed files in staging area to final location', async (t) => {
  const newPayload = buildPayload(t);
  const renamedFile = `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724.hdf.v20180926T131408705`;
  newPayload.input.push(renamedFile);
  await uploadFiles(newPayload.input, t.context.stagingBucket);

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);

  const check = await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf.v20180926T131408705'
  });

  t.true(check);
});

test.serial('should update filenames with metadata fields', async (t) => {
  const newPayload = buildPayload(t);
  const expectedFilenames = getExpectedOutputFileNames(t);

  await uploadFiles(newPayload.input, t.context.stagingBucket);

  const output = await moveGranules(newPayload);
  const outputFilenames = output.granules[0].files.map((f) => f.filename);
  t.deepEqual(expectedFilenames, outputFilenames);
});

test.serial('should preserve object tags', async (t) => {
  const newPayload = buildPayload(t);
  const tagset = [
    { Key: 'fakeTag', Value: 'test-tag' },
    { Key: 'granId', Value: newPayload.config.input_granules[0].granuleId }
  ];

  await uploadFiles(newPayload.input, t.context.stagingBucket);
  await updateFileTags(newPayload.input, t.context.stagingBucket, tagset);

  const output = await moveGranules(newPayload);
  await Promise.all(output.granules[0].files.map(async (file) => {
    const actualTags = await s3GetObjectTagging(file.bucket, file.filepath);
    t.deepEqual(
      { file: file.name, tagset },
      { file: file.name, tagset: actualTags.TagSet }
    );
  }));
});

test.serial('should overwrite files', async (t) => {
  const filename = 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg';
  const sourceKey = `file-staging/${filename}`;
  const destKey = `jpg/example/${filename}`;

  const newPayload = buildPayload(t);
  newPayload.config.duplicateHandling = 'replace';
  newPayload.input = [
    `s3://${t.context.stagingBucket}/${sourceKey}`
  ];
  newPayload.config.input_granules[0].files = [{
    filename: `s3://${t.context.stagingBucket}/${sourceKey}`,
    name: filename
  }];

  const uploadParams = {
    Bucket: t.context.stagingBucket,
    Key: sourceKey,
    Body: 'Something'
  };

  t.log(`CUMULUS-970 debugging: start s3 upload. params: ${JSON.stringify(uploadParams)}`);

  await promiseS3Upload(uploadParams);

  t.log(`CUMULUS-970 debugging: start move granules. params: ${JSON.stringify(newPayload)}`);

  let output = await moveGranules(newPayload);

  t.log('CUMULUS-970 debugging: move granules complete');

  await validateOutput(t, output);

  t.log(`CUMULUS-970 debugging: head object destKey ${destKey}`);

  const existingFile = await headObject(
    t.context.publicBucket,
    destKey
  );

  t.log('CUMULUS-970 debugging: headobject complete');

  // re-stage source jpg file with different content
  const content = randomString();

  uploadParams.Body = content;

  t.log(`CUMULUS-970 debugging: start s3 upload. params: ${JSON.stringify(uploadParams)}`);

  await promiseS3Upload({
    Bucket: t.context.stagingBucket,
    Key: sourceKey,
    Body: content
  });

  t.log(`CUMULUS-970 debugging: start move granules. params: ${JSON.stringify(newPayload)}`);

  output = await moveGranules(newPayload);

  t.log('CUMULUS-970 debugging:  move granules complete');

  const updatedFile = await headObject(
    t.context.publicBucket,
    destKey
  );

  t.log(`CUMULUS-970 debugging: start list objects. params: ${JSON.stringify({ Bucket: t.context.publicBucket })}`);

  const objects = await s3().listObjects({ Bucket: t.context.publicBucket }).promise();

  t.log('CUMULUS-970 debugging: list objects complete');

  t.is(objects.Contents.length, 1);

  const item = objects.Contents[0];
  t.is(item.Key, destKey);

  const existingModified = new Date(existingFile.LastModified).getTime();
  const itemModified = new Date(item.LastModified).getTime();
  t.true(itemModified > existingModified);

  t.is(updatedFile.ContentLength, content.length);
  t.true(output.granules[0].files[0].duplicate_found);
});

// duplicateHandling has default value 'error' if it's not provided in task configuration and
// collection configuration
async function duplicateHandlingErrorTest(t, duplicateHandling) {
  const newPayload = buildPayload(t);
  if (duplicateHandling) newPayload.config.duplicateHandling = duplicateHandling;

  await uploadFiles(newPayload.input, t.context.stagingBucket);

  let expectedErrorMessages;
  try {
    await validateConfig(t, newPayload.config);
    await validateInput(t, newPayload.input);

    // payload could be modified
    const newPayloadOrig = clonedeep(newPayload);

    const output = await moveGranules(newPayload);
    await validateOutput(t, output);

    expectedErrorMessages = output.granules[0].files.map((file) => {
      const parsed = parseS3Uri(file.filename);
      return `${parsed.Key} already exists in ${parsed.Bucket} bucket`;
    });

    await uploadFiles(newPayload.input, t.context.stagingBucket);
    await moveGranules(newPayloadOrig);
    t.fail('Expected a DuplicateFile error to be thrown');
  }
  catch (err) {
    t.true(err instanceof errors.DuplicateFile);
    t.true(expectedErrorMessages.includes(err.message));
  }
}

test.serial('when duplicateHandling is not specified, throw an error on duplicate', async (t) => {
  await duplicateHandlingErrorTest(t);
});

test.serial('when duplicateHandling is "error", throw an error on duplicate', async (t) => {
  await duplicateHandlingErrorTest(t, 'error');
});

test.serial('when duplicateHandling is "version", keep both data if different', async (t) => {
  let newPayload = buildPayload(t);
  newPayload.config.duplicateHandling = 'version';

  // payload could be modified
  const newPayloadOrig = clonedeep(newPayload);

  const expectedFilenames = getExpectedOutputFileNames(t);

  await uploadFiles(newPayload.input, t.context.stagingBucket);
  let output = await moveGranules(newPayload);
  const existingFileNames = output.granules[0].files.map((f) => f.filename);
  t.deepEqual(expectedFilenames, existingFileNames);

  const outputHdfFile = existingFileNames.filter((f) => f.endsWith('.hdf'))[0];
  const existingHdfFileInfo = await headObject(
    parseS3Uri(outputHdfFile).Bucket, parseS3Uri(outputHdfFile).Key
  );

  // When it encounters data with a duplicated filename with duplicate checksum,
  // it does not create a copy of the file.

  // When it encounters data with a dupliated filename with different checksum,
  // it moves the existing data to a file with a suffix to distinguish it from the new file

  // run 'moveGranules' again with one of the input files updated
  newPayload = clonedeep(newPayloadOrig);
  await uploadFiles(newPayload.input, t.context.stagingBucket);

  const inputHdfFile = newPayload.input.filter((f) => f.endsWith('.hdf'))[0];
  const params = {
    Bucket: t.context.stagingBucket, Key: parseS3Uri(inputHdfFile).Key, Body: randomString()
  };
  await s3().putObject(params).promise();

  output = await moveGranules(newPayload);
  const currentFileNames = output.granules[0].files.map((f) => f.filename);
  t.is(currentFileNames.length, 5);

  // the extra file is the renamed hdf file
  let extraFiles = currentFileNames.filter((f) => !existingFileNames.includes(f));
  t.is(extraFiles.length, 1);
  t.true(extraFiles[0].startsWith(`${outputHdfFile}.v`));

  // the existing hdf file gets renamed
  const renamedFile = extraFiles[0];
  const renamedHdfFileInfo = await headObject(
    parseS3Uri(renamedFile).Bucket, parseS3Uri(renamedFile).Key
  );
  t.deepEqual(existingHdfFileInfo, renamedHdfFileInfo);

  // new hdf file is moved to destination
  const newHdfFileInfo = await headObject(
    parseS3Uri(outputHdfFile).Bucket, parseS3Uri(outputHdfFile).Key
  );

  t.is(newHdfFileInfo.ContentLength, randomString().length);

  // run 'moveGranules' the third time with the same input file updated
  newPayload = clonedeep(newPayloadOrig);
  await uploadFiles(newPayload.input, t.context.stagingBucket);

  params.Body = randomString();
  await s3().putObject(params).promise();

  output = await moveGranules(newPayload);
  const lastFileNames = output.granules[0].files.map((f) => f.filename);
  t.is(lastFileNames.length, 6);

  // the extra files are the renamed hdf files
  extraFiles = lastFileNames.filter((f) => !existingFileNames.includes(f));
  t.is(extraFiles.length, 2);
  extraFiles.forEach((f) => t.true(f.startsWith(`${outputHdfFile}.v`)));

  output.granules[0].files.forEach((f) => {
    if (f.filename.startsWith(`${outputHdfFile}.v`) || f.filename.endsWith('.cmr.xml')) {
      t.falsy(f.duplicate_found);
    }
    else t.true(f.duplicate_found);
  });
});

test.serial('when duplicateHandling is "skip", does not overwrite or create new', async (t) => {
  let newPayload = buildPayload(t);
  newPayload.config.duplicateHandling = 'skip';

  // payload could be modified
  const newPayloadOrig = clonedeep(newPayload);

  const expectedFilenames = getExpectedOutputFileNames(t);

  await uploadFiles(newPayload.input, t.context.stagingBucket);
  let output = await moveGranules(newPayload);
  const existingFileNames = output.granules[0].files.map((f) => f.filename);
  t.deepEqual(expectedFilenames, existingFileNames);

  const outputHdfFile = existingFileNames.filter((f) => f.endsWith('.hdf'))[0];
  const existingHdfFileInfo = await headObject(
    parseS3Uri(outputHdfFile).Bucket, parseS3Uri(outputHdfFile).Key
  );

  // run 'moveGranules' again with one of the input files updated
  newPayload = clonedeep(newPayloadOrig);
  await uploadFiles(newPayload.input, t.context.stagingBucket);

  const inputHdfFile = newPayload.input.filter((f) => f.endsWith('.hdf'))[0];
  const params = {
    Bucket: t.context.stagingBucket, Key: parseS3Uri(inputHdfFile).Key, Body: randomString()
  };
  await s3().putObject(params).promise();

  output = await moveGranules(newPayload);
  const currentFileNames = output.granules[0].files.map((f) => f.filename);
  t.deepEqual(expectedFilenames, currentFileNames);

  // does not overwrite
  const currentHdfFileInfo = await headObject(
    parseS3Uri(outputHdfFile).Bucket, parseS3Uri(outputHdfFile).Key
  );

  t.is(existingHdfFileInfo.ContentLength, currentHdfFileInfo.ContentLength);
  t.not(currentHdfFileInfo.ContentLength, randomString().length);

  output.granules[0].files.forEach((f) => {
    if (f.filename.endsWith('.cmr.xml')) {
      t.falsy(f.duplicate_found);
    }
    else t.true(f.duplicate_found);
  });
});

async function granuleFilesOverwrittenTest(t, duplicateHandling, forceDuplicateOverwrite) {
  let newPayload = buildPayload(t);
  newPayload.config.duplicateHandling = duplicateHandling;
  set(newPayload, 'cumulus_config.cumulus_context.forceDuplicateOverwrite', forceDuplicateOverwrite);

  // payload could be modified
  const newPayloadOrig = clonedeep(newPayload);

  const expectedFilenames = getExpectedOutputFileNames(t);

  await uploadFiles(newPayload.input, t.context.stagingBucket);
  let output = await moveGranules(newPayload);
  await validateOutput(t, output);
  const existingFileNames = output.granules[0].files.map((f) => f.filename);
  t.deepEqual(expectedFilenames, existingFileNames);

  const existingFilesMetadata = await getFilesMetadata(output.granules[0].files);

  const outputHdfFile = existingFileNames.filter((f) => f.endsWith('.hdf'))[0];

  // run 'moveGranules' again with one of the input files updated
  newPayload = clonedeep(newPayloadOrig);
  await uploadFiles(newPayload.input, t.context.stagingBucket);

  const inputHdfFile = newPayload.input.filter((f) => f.endsWith('.hdf'))[0];
  const params = {
    Bucket: t.context.stagingBucket, Key: parseS3Uri(inputHdfFile).Key, Body: randomString()
  };
  await s3().putObject(params).promise();

  output = await moveGranules(newPayload);
  const currentFileNames = output.granules[0].files.map((f) => f.filename);
  t.is(currentFileNames.length, 4);

  const currentFilesMetadata = await getFilesMetadata(output.granules[0].files);

  const currentHdfFileMeta = currentFilesMetadata.filter((f) => f.filename === outputHdfFile)[0];
  t.is(currentHdfFileMeta.fileSize, randomString().length);

  // check timestamps are updated
  currentFilesMetadata.forEach((f) => {
    const existingFileMeta = existingFilesMetadata.filter((ef) => ef.filename === f.filename)[0];
    t.true(new Date(f.LastModified).getTime() > new Date(existingFileMeta.LastModified).getTime());
  });

  output.granules[0].files.forEach((f) => {
    if (f.filename.startsWith(`${outputHdfFile}.v`) || f.filename.endsWith('.cmr.xml')) {
      t.falsy(f.duplicate_found);
    }
    else t.true(f.duplicate_found);
  });
}

test.serial('when duplicateHandling is "replace", do overwrite files', async (t) => {
  await granuleFilesOverwrittenTest(t, 'replace');
});

test.serial('when duplicateHandling is "error" and forceDuplicateOverwrite is true, do overwrite files', async (t) => {
  await granuleFilesOverwrittenTest(t, 'error', true);
});

test.serial('when duplicateHandling is "skip" and forceDuplicateOverwrite is true, do overwrite files', async (t) => {
  await granuleFilesOverwrittenTest(t, 'skip', true);
});

test.serial('when duplicateHandling is "version" and forceDuplicateOverwrite is true, do overwrite files', async (t) => {
  await granuleFilesOverwrittenTest(t, 'version', true);
});

test.serial('when duplicateHandling is "replace" and forceDuplicateOverwrite is true, do overwrite files', async (t) => {
  await granuleFilesOverwrittenTest(t, 'replace', true);
});
