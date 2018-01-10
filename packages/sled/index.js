'use strict';

const path = require('path');
const fs = require('fs');
const message = require('./lib/message');
const Ajv = require('ajv');

/**
 * Returns an absolute path given a relative path within the task directory
 * @param {String} relativePath The relative path to resolve
 * @returns {String} The absolute path for the given relative path
 */
function taskPath(relativePath) {
  return path.resolve(__dirname, exports.config.taskRoot, relativePath);
}

/**
 * @param {String} relativePath The path to the schema
 * @returns {Promise} A promise resolving to the parsed contents of the file passed in
 */
function readJsonFile(relativePath) {
  return new Promise((resolve, reject) => {
    const filePath = taskPath(relativePath);

    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) return reject(err);
      return resolve(JSON.parse(data));
    });
  });
}

/**
 * Returns the handler function for the given module.function string
 * @param {String} handlerString The handler location as it would be passed to Lambda (e.g.
 *                              "index.handler")
 * @returns {Function} The handler function corresponding to the string
 */
function getNestedHandler(handlerString) {
  const errorHandler = (err) => (event, context, callback) => callback(err);

  const parts = handlerString.split('.');
  if (parts.length !== 2) {
    return errorHandler(`Bad handler ${handlerString}`);
  }
  const moduleName = parts[0];
  const handlerName = parts[1];
  try {
    const app = require(taskPath(moduleName)); // eslint-disable-line global-require
    const handler = app[handlerName];

    if (!handler) {
      return errorHandler(`Handler '${handlerName}' missing on module '${moduleName}'`);
    }
    return handler;
  }
  catch (e) {
    return errorHandler(e);
  }
}

/**
 * Given an inputs and the file name of a schema, validates the input.
 * @param {String} input A JSON document to be validated
 * @param {String} schemaFile The relative path to the schema
 * @returns {Promise} A Promise resolving to true if Input is valid or rejecting if it errors
 */
function validateJsonDocument(input, schemaFile) {
  if (input && schemaFile) {
    return readJsonFile(schemaFile)
      .then((schema) => {
        const ajv = new Ajv();
        const valid = ajv.validate(schema, input);
        if (!valid) {
          throw Error('Validation Error', ajv.errors);
        }
        return true;
      });
  }
  return Promise.resolve(true);
}

/**
 * Given a Lambda handler, event, and context, invokes the handler with the given event.
 * @param {Function} handler The Lambda handler to invoke
 * @param {*} event The event to pass to the Lambda.  Note: this is passed verbatim to the handler
 * @param {*} context The context object for the Lambda. done/succeed/fail methods will not be used
 * @returns {Promise} A Promise resolving to the handler's callback value or rejecting if it errors
 */
function invokeHandler(handler, event, context) {
  return new Promise((resolve, reject) => {
    const callback = (err, data) => {
      if (err) reject(err);
      else resolve(data);
    };
    const nestedContext = Object.assign({}, {
      done: callback,
      succeed: (data) => callback(null, data),
      fail: (err) => callback(err)
    }, context);
    handler(event, nestedContext, callback);
  });
}

/**
 * Lambda handler. Interprets incoming messages, passes them to an inner handler, gets the response
 * and transforms it into an outgoing message, returned by Lambda. Asynchronous.
 *
 * @param {*} event The Lambda event, a Cumulus protocol message
 * @param {*} context The Lambda context
 * @param {*} callback The Lambda callback, called with a Cumulus protocol output message
 */
exports.handler = function sledHandler(event, context, callback, handlerFn, handlerConfig) {
  let taskConfig = null;
  let taskHandler = null;
  let messageConfig = null;
  let fullEvent = null;
  let schemas = null;

  (handlerFn ? Promise.resolve(handlerConfig || {}) : readJsonFile('cumulus.json'))
    .then((config) => {
      taskConfig = config.task || {};
      return message.loadRemoteEvent(event);
    })
    .then((remoteEvent) => {
      fullEvent = remoteEvent;
      return message.loadNestedEvent(fullEvent, context);
    })
    .then((nestedEvent) => {
      messageConfig = nestedEvent.messageConfig;
      taskHandler = handlerFn || getNestedHandler(taskConfig.entrypoint || 'index.handler');
      schemas = taskConfig.schemas;
      if (schemas) { //Run Validation
        return validateJsonDocument(nestedEvent.input, schemas.input)
          .then(() => validateJsonDocument(nestedEvent.config, schemas.config))
          .then(() => {
            delete nestedEvent.messageConfig; // eslint-disable-line no-param-reassign
            return invokeHandler(taskHandler, nestedEvent, context);
          })
          .catch(callback);
      }
      delete nestedEvent.messageConfig; // eslint-disable-line no-param-reassign
      return invokeHandler(taskHandler, nestedEvent, context);
    })
    .then((handlerResponse) => {
      if (schemas) {
        return validateJsonDocument(handlerResponse, schemas.output)
          .then(() => message.createNextEvent(handlerResponse, fullEvent, messageConfig))
          .catch(callback);
      }
      return message.createNextEvent(handlerResponse, fullEvent, messageConfig);
    })
    .then((nextEvent) => callback(null, nextEvent))
    .catch((err) => {
      if (err.name && err.name.includes('WorkflowError')) {
        callback(null, Object.assign({}, fullEvent, { payload: null, exception: err.name }));
      }
      else {
        callback(err);
      }
    });
};

exports.config = {
  taskRoot: '..' // The filesystem location of the Lambda module
};

// Local testing. Run the handler.
if (process.argv[2] === 'local') {
  if (!process.argv[3]) throw new Error('Message identifier required');

  const messageName = process.argv[3];
  const event = JSON.parse(fs.readFileSync(`example/messages/${messageName}.input.json`, 'utf8'));
  const expectedOutputObj = JSON.parse(fs.readFileSync(`example/messages/${messageName}.output.json`, 'utf8'));
  const expectedOutput = JSON.stringify(expectedOutputObj);

  exports.config.taskRoot = 'example';
  exports.handler(event, {}, (err, data) => {
    if (err) {
      console.error('ERROR', err, err.stack);
    }
    else {
      const output = JSON.stringify(data);
      if (output !== expectedOutput) {
        throw new Error(`Bad output.  Expected:\n${expectedOutput}\nGot:\n${output}`);
      }
      console.log('Success', data);
    }
  }, (e, {}, cb) => {
    console.log(e);

    cb(null, e);
  });
}