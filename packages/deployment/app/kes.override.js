/* eslint-disable no-console, no-param-reassign */
'use strict';

const { Kes, Lambda } = require('kes');
const pLimit = require('p-limit');
const fs = require('fs');
const omit = require('lodash.omit');
const forge = require('node-forge');
const utils = require('kes').utils;

/**
 * Generates a public/private key pairs
 * @function generateKeyPair
 * @return {object} a forge pki object
 */
function generateKeyPair() {
  const rsa = forge.pki.rsa;
  console.log('Generating keys. It might take a few seconds!');
  return rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
}

function findOutputValue(outputs, key) {
  return outputs.find((o) => (o.OutputKey === key)).OutputValue;
}

/**
 * Creates the base Cumulus message template used to construct a Cumulus
 * message for Cumulus StepFunctions
 * @param  {object} config  Kes config object
 * @param  {object} outputs List of CloudFormations Output key and values
 * @return {object} a base Cumulus message template
 */
function baseInputTemplate(config, outputs) {
  // get cmr password from outputs
  const cmrPassword = findOutputValue(outputs, 'EncryptedCmrPassword');
  const topicArn = findOutputValue(outputs, 'sftrackerSnsArn');

  const template = {
    cumulus_meta: {
      stack: config.stackName,
      buckets: config.buckets,
      message_source: 'sfn'
    },
    meta: {
      cmr: config.cmr,
      distribution_endpoint: config.distribution_endpoint,
      topic_arn: topicArn
    },
    workflow_config: {},
    payload: {},
    exception: null
  };

  template.meta.cmr.password = cmrPassword;

  // add queues
  if (config.sqs) {
    template.meta.queues = {};
    const queueArns = outputs.filter(o => o.OutputKey.includes('SQSOutput'));

    queueArns.forEach((queue) => {
      template.meta.queues[queue.OutputKey.replace('SQSOutput', '')] = queue.OutputValue;
    });
  }

  return template;
}

/**
 * generates a Cumulus message Template for a given step function
 * @param  {object} template base message template
 * @param  {object} sf StepFunction definition (part of kes config)
 * @param  {object} sfConfigs Sled configs for the StepFunction (part of kes config)
 * @param  {string} wfArn StepFunction Arn
 * @return {object} stepFunction template
 */
function buildStepFunctionMessageTemplate(template, sf, sfConfigs, wfArn) {
  // add workflow configs for each step function step
  Object.keys(sf.definition.States).forEach(name => {
    template.workflow_config[name] = sfConfigs[sf.name][name];
  });

  // update cumulus_meta for each workflow message tempalte
  template.cumulus_meta.state_machine = wfArn;
  template.cumulus_meta.workflow_name = sf.name;

  return msg;
}

/**
 * Generates an template used for SFScheduler to create cumulus
 * payloads for step functions. Each step function gets a separate
 * template
 *
 * @function generateInputTemplates
 * @param  {object} config Kes Config Object
 * @param  {array} outputs Array of CloudFormation outputs
 * @return {array} list of templates
 */
function generateInputTemplates(config, outputs) {
  const templates = [];

  // generate a output template for each workflow
  if (config.stepFunctions) {
    config.stepFunctions.forEach((sf) => {
      const msg = baseInputTemplate(config, outputs);

      // get workflow arn
      const wfArn = findOutputValue(outputs, `${sf.name}StateMachine`);
      templates.push(buildStepFunctionMessageTemplate(msg, sf, config.stepFunctions.configs, wfArn));
    });
  }
  return templates;
}

/**
 * Generate a list of workflows (step functions) that are uploaded to S3. This
 * list is used by the Cumulus Dashboard to show the workflows.
 *
 * @function generateWorkflowsList
 * @param  {object} config Kes Config object
 * @return {array} Array of objects that include workflow name, template s3 uri and definition
 */
function generateWorkflowsList(config) {
  const workflows = [];
  if (config.stepFunctions) {
    config.stepFunctions.forEach((sf) => {
      workflows.push({
        name: sf.name,
        template: `s3://${config.buckets.internal}/${config.stackName}/workflows/${sf.name}.json`,
        definition: sf.definition
      });
    });

    return workflows;
  }

  return false;
}


class UpdatedLambda extends Lambda {
  /**
   * Copy source code of a given lambda function, zips it, calculate
   * the hash of the source code and updates the lambda object with
   * the hash, local and remote locations of the code
   *
   * @param {Object} lambda the lambda object
   * @returns {Promise} returns the updated lambda object
   */
  zipLambda(lambda) {
    console.log(`Zipping ${lambda.local} and injecting sled`);

    // skip if the file with the same hash is zipped
    if (fs.existsSync(lambda.local)) {
      return Promise.resolve(lambda);
    }

    return utils.zip(lambda.local, [lambda.source, this.config.sled]).then(() => lambda);
  }

  buildS3Path(lambda) {
    lambda = super.buildS3Path(lambda);

    if (lambda.useSled) {
      lambda.handler = 'cumulus-sled.handler';
    }
    return lambda;
  }
}

/**
 * A subclass of Kes class that overrides opsStack method.
 * The subclass is checks whether the public/private keys are generated
 * and uploaded to the deployment bucket. If not, they are generated and
 * uploaded.
 *
 * After the successful deployment of a CloudFormation template, the subclass
 * generates and uploads payload and stepfunction templates and restart ECS
 * tasks if there is an active cluster with running tasks.
 *
 * @class UpdatedKes
 */
class UpdatedKes extends Kes {
  constructor(config) {
    super(config);
    this.Lambda = UpdatedLambda;
  }

  async redployApiGateWay(name, restApiId, stageName) {
    if (restApiId) {
      const apigateway = new this.AWS.APIGateway();
      const r = await apigateway.createDeployment({ restApiId, stageName }).promise();
      console.log(`${name} endpoints with the id ${restApiId} redeployed.`);
      return r;
    }
    return true;
  }

  /**
   * Restart all active tasks in the clusters of a deployed
   * cloudformation
   *
   * @param  {object} config Kes Config object
   * @return {Promise}
   */
  async restartECSTasks(config) {
    const ecs = new this.AWS.ECS();

    try {
      let resources = [];
      const params = { StackName: config.stackName };
      while (true) { // eslint-disable-line no-constant-condition
        const data = await this.cf.listStackResources(params).promise();
        resources = resources.concat(data.StackResourceSummaries);
        if (data.NextToken) params.NextToken = data.NextToken;
        else break;
      }

      const clusters = resources.filter(item => {
        if (item.ResourceType === 'AWS::ECS::Cluster') return true;
        return false;
      });

      for (const cluster of clusters) {
        const tasks = await ecs.listTasks({ cluster: cluster.PhysicalResourceId }).promise();
        for (const task of tasks.taskArns) {
          console.log(`restarting ECS task ${task}`);
          await ecs.stopTask({
            task: task,
            cluster: cluster.PhysicalResourceId
          }).promise();
          console.log(`ECS task ${task} restarted`);
        }
      }
    }
    catch (err) {
      console.log(err);
    }
  }

  /**
   * Uploads the generated private and public key pair
   *
   * @param  {string} bucket the bucket to upload the keys to
   * @param  {string} key    the key (folder) to use for the uploaded files
   * @return {Promise} aws promise of the upload to s3
   */
  uploadKeyPair(bucket, key) {
    const pki = forge.pki;
    const keyPair = generateKeyPair();
    console.log('Keys Generated');

    // upload the private key
    const privateKey = pki.privateKeyToPem(keyPair.privateKey);
    const params1 = {
      Bucket: bucket,
      Key: `${key}/private.pem`,
      ACL: 'private',
      Body: privateKey
    };

    // upload the public key
    const publicKey = pki.publicKeyToPem(keyPair.publicKey);
    const params2 = {
      Bucket: bucket,
      Key: `${key}/public.pub`,
      ACL: 'private',
      Body: publicKey
    };

    return this.s3.putObject(params1).promise()
      .then(() => this.s3.putObject(params2).promise())
      .then(() => console.log('keys uploaded to S3'));
  }

  /**
   * Checks if the private/public key exists. If not
   * generate and upload them
   *
   * @return {Promise}
   */
  crypto() {
    const key = `${this.stack}/crypto`;

    // check if files are generated
    return this.s3.headObject({
      Key: `${key}/public.pub`,
      Bucket: this.bucket
    }).promise()
      .then(() => this.s3.headObject({
        Key: `${key}/public.pub`,
        Bucket: this.bucket
      }).promise())
      .catch(() => this.uploadKeyPair(this.bucket, key));
  }

  /**
   * Because both kes and sled use Mustache for templating,
   * we have to curly brackes for all the templating values
   * that has to be passed to sled. this method, looks for
   * any value that starts with a "$" and put the whole value
   * inside "{{ }}""
   */
  cleanStepFunctionDefinition() {
    const sFconfigs = {};
    const test = new RegExp('^\\$\\.');

    const addCurly = (config) => {
      if (config) {
        Object.keys(config).forEach(n => {
          if (typeof config[n] === 'object') {
            config[n] = addCurly(config[n]);
          }
          else if (typeof config[n] === 'string') {
            const match = config[n].match(test);
            if (match) {
              config[n] = `{{${config[n]}}}`;
            }
          }
        });
      }
      return config;
    };

    // loop through the sled config of each step of 
    // the step function, add curly brackets to values
    // with dollar sign and remove config key from the
    // defintion, otherwise CloudFormation will be mad
    // at us.
    this.config.stepFunctions.forEach((sf) => {
      sFconfigs[sf.name] = {};
      Object.keys(sf.definition.States).forEach((n) => {
        sFconfigs[sf.name][n] = addCurly(sf.definition.States[n].config);
        sf.definition.States[n] = omit(sf.definition.States[n], ['config']);
      });
    });

    this.config.stepFunctions.configs = sFconfigs;
  }

  /**
   * Override opsStack method.
   *
   * @return {Promise}
   */
  opsStack() {
    // check if public and private key are generated
    // if not generate and upload them
    const apis = {};

    const limit = pLimit(1);

    // remove config variable from all workflow steps
    // and keep them in a separate variable.
    // this is needed to prevent stepfunction deployment from crashing
    this.cleanStepFunctionDefinition();

    return this.crypto(this.bucket, this.stack)
      .then(() => super.opsStack())
      .then(() => this.describeCF())
      .then((r) => {
        const outputs = r.Stacks[0].Outputs;

        const urls = {
          Api: 'token',
          Distribution: 'redirect'
        };
        console.log('\nHere are the important URLs for this deployment:\n');
        outputs.forEach((o) => {
          if (Object.keys(urls).includes(o.OutputKey)) {
            console.log(`${o.OutputKey}: `, o.OutputValue);
            console.log('Add this url to URS: ', `${o.OutputValue}${urls[o.OutputKey]}`, '\n');

            if (o.OutputKey === 'Distribution') {
              this.config.distribution_endpoint = o.OutputValue;
            }
          }

          switch (o.OutputKey) {
            case 'ApiId':
              apis.api = o.OutputValue;
              break;
            case 'DistributionId':
              apis.distribution = o.OutputValue;
              break;
            case 'ApiStage':
              apis.stageName = o.OutputValue;
              break;
            default:
              //nothing
          }
        });

        const workflowInputs = generateInputTemplates(this.config, outputs);
        const stackName = this.stack;

        console.log('Uploading Workflow Input Templates');
        const uploads = workflowInputs.map((w) => limit(
          () => {
            const workflowName = w.cumulus_meta.workflow_name;
            const key = `${stackName}/workflows/${workflowName}.json`;
            return this.uploadToS3(
              this.bucket,
              key,
              JSON.stringify(w)
            );
          }
        ));

        const workflows = generateWorkflowsList(this.config);

        if (workflows) {
          uploads.push(limit(() => this.uploadToS3(
            this.bucket,
            `${stackName}/workflows/list.json`,
            JSON.stringify(workflows)
          )));
        }

        return Promise.all(uploads);
      })
      .then(() => this.restartECSTasks(this.config))
      .then(() => {
        const updates = [
          this.redployApiGateWay('api', apis.api, apis.stageName),
          this.redployApiGateWay('distribution', apis.distribution, apis.stageName)
        ];

        return Promise.all(updates);
      });
  }
}

module.exports = UpdatedKes;
