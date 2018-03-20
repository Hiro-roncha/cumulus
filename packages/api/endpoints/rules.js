/* eslint-disable no-param-reassign */
'use strict';

const _get = require('lodash.get');
const { justLocalRun } = require('@cumulus/common/local-helpers');
const { inTestMode } = require('@cumulus/common/test-utils');
const { handle } = require('../lib/response');
const models = require('../models');
const { RecordDoesNotExist } = require('../lib/errors');
const { Search } = require('../es/search');

/**
 * List all providers.
 * @param {object} event aws lambda event object.
 * @param {callback} cb aws lambda callback function
 * @return {undefined}
 */
function list(event, cb) {
  const search = new Search(event, 'rule');
  search.query().then(response => cb(null, response)).catch(cb);
}

/**
 * Query a single rule.
 * @param {object} event aws lambda event object.
 * @param {string} granuleId the id of the granule.
 * @return {object} a single granule object.
 */
function get(event, cb) {
  const name = _get(event.pathParameters, 'name');

  const model = new models.Rule();
  return model.get({ name })
    .then((res) => {
      delete res.password;
      cb(null, res);
    })
    .catch(cb);
}

/**
 * Creates a new rule
 * @param {object} event aws lambda event object.
 * @return {object} returns the collection that was just saved.
 */
function post(event, cb) {
  let data = _get(event, 'body', '{}');
  data = JSON.parse(data);
  const name = _get(data, 'name');

  const model = new models.Rule();

  return model.get({ name })
    .then(() => cb({ message: `A record already exists for ${name}` }))
    .catch((e) => {
      if (e instanceof RecordDoesNotExist) {
        return model.create(data)
          .then(r => cb(null, { message: 'Record saved', record: r }))
          .catch(cb);
      }
      return cb(e);
    });
}

/**
 * Updates an existing rule
 * @param {object} event aws lambda event object.
 * @return {object} a mapping of the updated properties.
 */
async function put(event) {
  const name = _get(event.pathParameters, 'name');

  let data = _get(event, 'body', '{}');
  data = JSON.parse(data);
  const action = _get(data, 'action');

  const model = new models.Rule();

  // if the data includes any fields other than state and rule.value
  // throw error
  if (action && action !== 'rerun') {
    let check = Object.keys(data).filter(f => (f !== 'state' && f !== 'rule'));
    if (data.rule) {
      check = check.concat(Object.keys(data.rule).filter(f => f !== 'value'));
    }
    if (check.length > 0) {
      throw new Error('Only state and rule.value values can be changed');
    }
  }

  // get the record first
  let originalData;
  try {
    originalData = await model.get({ name });
  }
  catch (e) {
    if (e instanceof RecordDoesNotExist) {
      throw new Error({ message: 'Record does not exist' });
    }
  }

  // if rule type is onetime no change is allowed unless it is a rerun
  if (action === 'rerun') {
    await models.Rule.invoke(originalData);
    return;
  }

  return model.update(originalData, data);
}

async function del(event) {
  let name = _get(event.pathParameters, 'name', '');
  const model = new models.Rule();

  name = name.replace(/%20/g, ' ');

  await model.get({ name }).then(record => model.delete(record));
  return { message: 'Record deleted' };
}

function handler(event, context) {
  return handle(event, context, !inTestMode() /* authCheck */, cb => {
    if (event.httpMethod === 'GET' && event.pathParameters) {
      get(event, cb);
    }
    else if (event.httpMethod === 'POST') {
      post(event, cb);
    }
    else if (event.httpMethod === 'PUT' && event.pathParameters) {
      put(event).then(r => cb(null, r)).catch(e => cb(JSON.stringify(e)));
    }
    else if (event.httpMethod === 'DELETE' && event.pathParameters) {
      del(event).then(r => cb(null, r)).catch(e => cb(JSON.stringify(e)));
    }
    else {
      list(event, cb);
    }
  });
}

module.exports = handler;
