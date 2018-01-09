'use strict';
const get = require('lodash.get');
const errors = require('@cumulus/common/errors');
const lock = require('@cumulus/ingest/lock');
const granule = require('@cumulus/ingest/granule');
const logger = require('@cumulus/ingest/log');

const log = logger.child({ file: 'sync-granule/index.js' });

async function download(ingest, bucket, provider, granules) {
  const updatedGranules = [];

  const proceed = await lock.proceed(bucket, provider, granules[0].granuleId);

  if (!proceed) {
    const err = new errors.ResourcesLockedError(
      'Download lock remained in place after multiple tries'
    );
    log.error(err);
    throw err;
  }

  for (const g of granules) {
    try {
      const r = await ingest.ingest(g);
      updatedGranules.push(r);
    }
    catch (e) {
      await lock.removeLock(bucket, provider.id, g.granuleId);
      log.error(e);
      throw e;
    }
  }

  await lock.removeLock(bucket, provider.id, granules[0].granuleId);
  return updatedGranules;
}

module.exports.handler = function handler(_event, context, cb) {
  try {
    const event = Object.assign({}, _event);
    const config = get(event, 'config', {});
    const input = get(event, 'input', {});

    const buckets = get(config, 'buckets');
    const collection = get(config, 'collection.meta');
    const provider = get(config, 'provider');
    const granules = get(input, 'granules');

    const output = {};

    if (!provider) {
      const err = new errors.ProviderNotFound('Provider info not provided');
      log.error(err);
      return cb(err);
    }

    const IngestClass = granule.selector('ingest', provider.protocol);
    const ingest = new IngestClass(event);

    return download(ingest, buckets.internal, provider, granules).then((gs) => {
      output.granules = gs;

      if (collection.process) {
        output.process = collection.process;
      }

      if (ingest.end) {
        ingest.end();
      }

      return cb(null, output);
    }).catch(e => {
      if (ingest.end) {
        ingest.end();
      }

      if (e.toString().includes('ECONNREFUSED')) {
        const err = new errors.RemoteResourceError('Connection Refused');
        log.error(err);
        return cb(err);
      }
      else if (e.details && e.details.status === 'timeout') {
        const err = new errors.ConnectionTimeout('connection Timed out');
        log.error(err);
        return cb(err);
      }

      log.error(e);
      return cb(e);
    });
  }
  catch (e) {
    log.error(e);
    throw e;
  }
};
