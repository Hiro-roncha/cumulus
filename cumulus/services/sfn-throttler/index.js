'use strict';

const aws = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');
const _ = require('lodash');

/**
 * Queries AWS to determine the number of running excutions of a given state machine.
 * @param {string} stateMachineArn The ARN of the state machine to check.
 * @return {number} The number of running executions
 */
const runningExecutionCount = async (stateMachineArn) => {
  const data = await aws.sfn().listExecutions({
    stateMachineArn,
    statusFilter: 'RUNNING'
  }).promise();

  const count = data.executions.length;
  log.info(`Found ${count} running executions of ${stateMachineArn}.`);
  return count;
};

const fetchMessages = async (queueUrl, count) => {
  const maxNumberOfMessages = Math.min(count, 10);

  const data = await aws.sqs().receiveMessage({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: maxNumberOfMessages
  }).promise();

  const messages = data.Messages || [];
  // eslint-disable-next-line max-len
  log.info(`Tried to fetch ${maxNumberOfMessages} messages from ${queueUrl} and got ${messages.length}.`);
  return messages;
};

function startExecution(executionParams) {
  log.info(`Starting an execution of ${executionParams.stateMachineArn}`);

  return aws.sfn().startExecution(executionParams).promise();
}

/**
 * Delete a message from an SQS queue.
 * @param {string} queueUrl The URL of the SQS queue.
 * @param {Object} message An SQS message, in the same format as received from
 *   AWS.SQS.receiveMessage().
 * @return {Promise}
 */
function deleteMessage(queueUrl, message) {
  log.info(`Deleting ${message.ReceiptHandle} from ${queueUrl}`);

  aws.sqs().deleteMessage({
    QueueUrl: queueUrl,
    ReceiptHandle: message.ReceiptHandle
  }).promise();
}

const startExecutions = async (queueUrl, stateMachineArn, count) => {
  const messages = await fetchMessages(queueUrl, count);

  const executionPromises = messages.map((message) =>
    startExecution(JSON.parse(message.Body))
      .then(() => deleteMessage(queueUrl, message)));

  return Promise.all(executionPromises);
};

const manageThrottledStepFunction = async (queueUrl, stateMachineArn, maxConcurrentExecutions) => {
  const count = await runningExecutionCount(stateMachineArn);
  const executionsToStart = maxConcurrentExecutions - count;

  let sleepTimeInMs = 5000;

  if (executionsToStart > 0) {
    log.info('Executions to start: ', executionsToStart);
    await startExecutions(queueUrl, stateMachineArn, executionsToStart);
    sleepTimeInMs = 1000;
  }
  else {
    log.info('No executions to start');
  }

  log.info(`Sleeping for ${sleepTimeInMs} ms before managing ${stateMachineArn} again`);
  setTimeout(
    manageThrottledStepFunction,
    sleepTimeInMs,
    queueUrl,
    stateMachineArn,
    maxConcurrentExecutions,
  );
};

function mapLogicalIdsToArns(resources) {
  return _.fromPairs(resources.map((r) => [r.LogicalResourceId, r.PhysicalResourceId]));
}

const buildExecutionConfigsFromEvent = async (event) => {
  const stackResources = await aws.describeCfStackResources(event.cloudFormationStackName);
  const arnsByLogicalId = mapLogicalIdsToArns(stackResources);

  return event.stateMachineConfigs.map((stateMachineConfig) => {
    const id = `${event.stateMachinePrefix}${stateMachineConfig.stateMachineName}`;
    return _.set(stateMachineConfig, 'stateMachineArn', arnsByLogicalId[id]);
  });
};

module.exports.handler = function handler(event) {
  buildExecutionConfigsFromEvent(event)
    .then((executionConfigs) => {
      executionConfigs.forEach((executionConfig) => {
        manageThrottledStepFunction(
          executionConfig.sqsQueueUrl,
          executionConfig.stateMachineArn,
          executionConfig.maxConcurrentExecutions
        );
      });
    });
};
