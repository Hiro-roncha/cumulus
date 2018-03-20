/* eslint-disable no-param-reassign */
'use strict';

const _get = require('lodash.get');
const { inTestMode } = require('@cumulus/common/test-utils');
const { handle } = require('../lib/response');
const models = require('../models');
const RecordDoesNotExist = require('../lib/errors').RecordDoesNotExist;
const { Search } = require('../es/search');

/**
 * List all providers.
 * @param {object} event aws lambda event object.
 * @param {callback} cb aws lambda callback function
 * @return {undefined}
 */
function list(event, cb) {
  const search = new Search(event, 'provider');
  search.query().then(response => cb(null, response)).catch(cb);
}

/**
 * Query a single provider.
 * @param {object} event aws lambda event object.
 * @param {string} granuleId the id of the granule.
 * @return {object} a single granule object.
 */
function get(event, cb) {
  const id = _get(event.pathParameters, 'id');
  if (!id) {
    return cb('provider id is missing');
  }

  const p = new models.Provider();
  return p.get({ id })
    .then((res) => {
      delete res.password;
      cb(null, res);
    })
    .catch(cb);
}

/**
 * Creates a new provider
 * @param {object} event aws lambda event object.
 * @return {object} returns the collection that was just saved.
 */
function post(event, cb) {
  let data = _get(event, 'body', '{}');
  data = JSON.parse(data);
  const id = _get(data, 'id');

  const p = new models.Provider();

  return p.get({ id })
    .then(() => cb({ message: `A record already exists for ${id}` }))
    .catch((e) => {
      if (e instanceof RecordDoesNotExist) {
        return p.create(data)
          .then(data => cb(null, { message: 'Record saved', record: data }))
          .catch(err => cb(err));
      }
      return cb(e);
    });
}

/**
 * Updates an existing provider
 * @param {object} event aws lambda event object.
 * @return {object} a mapping of the updated properties.
 */
function put(event, cb) {
  const id = _get(event.pathParameters, 'id');

  if (!id) {
    return cb('provider id is missing');
  }

  let data = _get(event, 'body', '{}');
  let originalData;
  data = JSON.parse(data);

  const p = new models.Provider();

  // get the record first
  return p.get({ id }).then((d) => {
    originalData = d;
    return p.update({ id }, data);
  })
  .then(data => cb(null, data))
  .catch((err) => {
    if (err instanceof RecordDoesNotExist) cb({ message: 'Record does not exist' });
    return cb(err);
  });
}

function del(event, cb) {
  const id = _get(event.pathParameters, 'id');
  const p = new models.Provider();

  return p.get({ id })
    .then(() => p.delete({ id }))
    .then(() => cb(null, { message: 'Record deleted' }))
    .catch(cb);
}

function handler(event, context) {
  handle(event, context, !inTestMode() /* authCheck */, (cb) => {
    if (event.httpMethod === 'GET' && event.pathParameters) {
      get(event, cb);
    }
    else if (event.httpMethod === 'POST') {
      post(event, cb);
    }
    else if (event.httpMethod === 'PUT' && event.pathParameters) {
      put(event, cb);
    }
    else if (event.httpMethod === 'DELETE' && event.pathParameters) {
      del(event, cb);
    }
    else {
      list(event, cb);
    }
  });
}

module.exports = handler;
