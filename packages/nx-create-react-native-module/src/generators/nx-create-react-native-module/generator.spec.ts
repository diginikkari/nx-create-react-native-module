import { createTreeWithEmptyWorkspace } from '@nrwl/devkit/testing';
import { Tree, readJson, readProjectConfiguration } from '@nrwl/devkit';

import generator from './generator';
import { NxCreateReactNativeModuleGeneratorSchema } from './schema';
import { Linter } from '@nrwl/linter';

describe('nx-create-react-native-module generator', () => {
  let appTree: Tree;
  const options: NxCreateReactNativeModuleGeneratorSchema = {
    name: 'MyNativeModule',
    authorEmail: 'first.last@email.com',
    authorName: 'First Last',
    authorUrl: 'https://www.example.com',
    languages: 'kotlin-swift',
    type: 'module',
    linter: Linter.EsLint,
    skipFormat: false,
    skipTsConfig: false,
    unitTestRunner: 'jest',
    strict: true,
  };

  beforeEach(() => {
    appTree = createTreeWithEmptyWorkspace();
    appTree.write('.gitignore', '');
  });

  it('should update workspace.json', async () => {
    await generator(appTree, { ...options, tags: 'one,two' });
    const workspaceJson = readJson(appTree, '/workspace.json');
    expect(workspaceJson.projects['my-native-module'].root).toEqual(
      'libs/my-native-module'
    );
    expect(workspaceJson.projects['my-native-module'].architect.lint).toEqual({
      builder: '@nrwl/linter:eslint',
      outputs: ['{options.outputFile}'],
      options: {
        lintFilePatterns: ['libs/my-native-module/**/*.{ts,tsx,js,jsx}'],
      },
    });
    expect(workspaceJson.projects['my-native-module'].tags).toEqual([
      'one',
      'two',
    ]);
  });

  it('should run successfully', async () => {
    await generator(appTree, options);
    const config = readProjectConfiguration(appTree, 'my-native-module');
    expect(config).toBeDefined();
  });
});
