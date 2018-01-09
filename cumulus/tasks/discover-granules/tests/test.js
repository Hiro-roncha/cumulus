'use strict';

import test from 'ava';
import sinon from 'sinon';
import { handler as sled } from '@cumulus/sled';
import log from '@cumulus/common/log';
import amsr2 from '@cumulus/test-data/payloads/amsr2/discover.json';
import queue from '@cumulus/ingest/queue';
import { S3 } from '@cumulus/ingest/aws';
import mur from './fixtures/mur.json';
import sledInput from './fixtures/sled-input.json';
import { handler } from '../index';

test.cb('test discovering mur granules', (t) => {
  const newMur = JSON.parse(JSON.stringify(mur));

  sinon.stub(S3, 'fileExists').callsFake(() => false);

  // make sure queue is not used
  newMur.config.useQueue = false;

  handler(newMur, {}, (e, output) => {
    if (e && e.message.includes('getaddrinfo ENOTFOUND')) {
      log.info('ignoring this test. Test server seems to be down');
    }
    else {
      const granules = output.granules;
      t.is(Object.keys(granules).length, 3);
      const g = Object.keys(granules)[0];
      t.is(granules[g].files.length, 2);
    }
    S3.fileExists.restore();
    t.end(e);
  });
});

test.cb('test discovering mur granules with queue', (t) => {
  const newMur = Object.assign({}, mur);
  sinon.stub(queue, 'queueGranule').callsFake(() => true);
  sinon.stub(S3, 'fileExists').callsFake(() => false);

  // update discovery rule
  const rule = '/allData/ghrsst/data/GDS2/L4/GLOB/JPL/MUR/v4.1/2017/(20[1-3])';
  newMur.config.useQueue = true;
  newMur.config.collection.meta.provider_path = rule;

  handler(newMur, {}, (e, output) => {
    if (e && e.message.includes('getaddrinfo ENOTFOUND')) {
      log.info('ignoring this test. Test server seems to be down');
    }
    else {
      t.is(output.granules_found, 3);
    }
    S3.fileExists.restore();
    queue.queueGranule.restore();
    t.end(e);
  });
});


test.cb('test discovering amsr2 granules using SFTP', (t) => {
  if (!process.env.JAXA_HOST || !process.env.JAXA_PORT) {
    log.info('Skipping SFTP test because credentials are not set');
    t.end();
  }
  else {
    const payload = Object.assign({}, amsr2);
    payload.config.provider.host = process.env.JAXA_HOST;
    payload.config.provider.port = process.env.JAXA_PORT;
    payload.config.provider.username = process.env.JAXA_USER;
    payload.config.provider.password = process.env.JAXA_PASS;
    payload.config.provider.encrypted = true;

    // update discovery rule
    payload.config.useQueue = false;
    payload.input = {};

    handler(payload, {}, (e, output) => {
      const granules = output.granules;
      t.true(Object.keys(granules).length > 5);
      const g = Object.keys(granules)[0];
      t.is(granules[g].files.length, 1);
      t.end(e);
    });
  }
});

test.cb('test running in sled', (t) => {
  sinon.stub(S3, 'fileExists').callsFake(() => false);

  function callback (err, output) {
    t.ifError(err);
    const granules = output.payload.granules;
    t.is(Object.keys(granules).length, 3);
    const g = Object.keys(granules)[0];
    t.is(granules[g].files.length, 2);
    S3.fileExists.restore();
    t.end();
  }

  sled(sledInput, {}, callback, handler)
});
