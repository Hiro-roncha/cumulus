const { buildAndExecuteWorkflow, LambdaStep } = require('@cumulus/integration-tests');
const { loadConfig } = require('../helpers/testUtils');

const awsConfig = loadConfig();
const lambdaStep = new LambdaStep();

describe('The Hello World workflow', () => {
  let workflowExecution = null;

  beforeAll(async () => {
    workflowExecution = await buildAndExecuteWorkflow(
      awsConfig.stackName,
      awsConfig.bucket,
      'HelloWorldWorkflow'
    );
  });

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('the HelloWorld Lambda', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'HelloWorld');
    });

    it('output is Hello World', () => {
      expect(lambdaOutput.payload).toEqual({ hello: 'Hello World' });
    });
  });
});
