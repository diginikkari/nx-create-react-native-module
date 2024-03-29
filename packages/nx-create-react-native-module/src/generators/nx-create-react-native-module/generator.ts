import {
  Tree,
  formatFiles,
  installPackagesTask,
  readWorkspaceConfiguration,
  logger,
  generateFiles,
  joinPathFragments,
} from '@nrwl/devkit';
import { reactNativeLibraryGenerator } from '@nrwl/react-native';
import { normalizeOptions } from '@nrwl/react-native/src/generators/library/lib/normalize-options';
import { NxCreateReactNativeModuleGeneratorSchema } from './schema';

import * as path from 'path';
import {
  ensureDirSync,
  statSync,
  readFileSync,
  readdirSync,
  createReadStream,
} from 'fs-extra';
import * as tar from 'tar';
import * as ejs from 'ejs';
import { createGunzip } from 'zlib';
import { join } from 'path';
import {
  createTempNpmDirectory,
  packageRegistryPack,
} from 'nx/src/utils/package-manager';

const BINARIES = /(gradlew|\.(jar|keystore|png|jpg|gif))$/;

export default async function (
  tree: Tree,
  schema: NxCreateReactNativeModuleGeneratorSchema
) {
  // Generate basic react native library using NX React Native Library Generator
  schema.buildable = true;
  await reactNativeLibraryGenerator(tree, schema);
  const options = normalizeOptions(tree, schema);

  // Get workspace configuration
  const workspace = readWorkspaceConfiguration(tree);

  const tempNpmDir = createTempNpmDirectory();
  try {
    const { tarballPath } = await packageRegistryPack(
      tempNpmDir.dir,
      'create-react-native-library',
      '0.23.3'
    );

    await extractDirectoryFromTarball(
      join(tempNpmDir.dir, tarballPath),
      'templates',
      join(tempNpmDir.dir, 'templates')
    );
  } catch (e) {
    console.error(e);
  }

  // Prepare options for ejs
  const templateOptions = {
    ...options,
    project: {
      slug: options.name,
      description: schema.description || '',
      name: `${options.name.charAt(0).toUpperCase()}${options.name
        .replace(/[^a-z0-9](\w)/g, (_, $1) => $1.toUpperCase())
        .slice(1)}`,
      package: options.name.replace(/[^a-z0-9]/g, '').toLowerCase(),
      identifier: options.name.replace(/[^a-z0-9]+/g, '-').replace(/^-/, ''),
      cpp: schema.languages === 'cpp',
      kotlin:
        schema.languages === 'kotlin-objc' ||
        schema.languages === 'kotlin-swift',
      swift:
        schema.languages === 'java-swift' ||
        schema.languages === 'kotlin-swift',
      moduleType: schema.type,
    },
    author: {
      name: schema.authorName,
      email: schema.authorEmail,
      url: schema.authorUrl,
    },
    repo: `${options.name}`,
    version: workspace.version,
  };

  const { type } = schema;
  const moduleType = type === 'view' ? 'view' : 'module';
  const architecture =
    type === 'module-turbo'
      ? 'turbo'
      : type === 'module-mixed'
      ? 'mixed'
      : 'legacy';

  // Get path to template files from create-react-native-library
  // const createReactNativeLibraryRoot = path.dirname(
  //   require.resolve('create-react-native-library/package.json')
  // );

  const templates = path.join(tempNpmDir.dir, 'templates');

  const CPP_FILES = path.join(templates, 'cpp-library');

  const NATIVE_COMMON_FILES = path.resolve(
    path.join(templates, 'native-common')
  );

  const NATIVE_FILES = {
    module_legacy: path.join(templates, 'native-library-legacy'),
    module_turbo: path.join(templates, 'native-library-turbo'),
    module_mixed: path.join(templates, 'native-library-mixed'),
    view: path.join(templates, 'native-view-library'),
  };

  const JAVA_FILES = {
    module_legacy: path.join(templates, 'java-library-legacy'),
    module_turbo: path.join(templates, 'java-library-turbo'),
    module_mixed: path.join(templates, 'java-library-mixed'),
    view: path.join(templates, 'java-view-library'),
  };

  const OBJC_FILES = {
    module: path.join(templates, 'objc-library'),
    view: path.join(templates, 'objc-view-library'),
  };

  const KOTLIN_FILES = {
    module: path.join(templates, 'kotlin-library'),
    view: path.join(templates, 'kotlin-view-library'),
  };

  const SWIFT_FILES = {
    module: path.join(templates, 'swift-library'),
    view: path.join(templates, 'swift-view-library'),
  };

  if (templateOptions.project.swift) {
    copyDir(
      tree,
      SWIFT_FILES[moduleType],
      options.projectRoot,
      templateOptions
    );
  } else {
    copyDir(tree, OBJC_FILES[moduleType], options.projectRoot, templateOptions);
  }

  if (templateOptions.project.kotlin) {
    copyDir(
      tree,
      KOTLIN_FILES[moduleType],
      options.projectRoot,
      templateOptions
    );
  } else {
    copyDir(tree, JAVA_FILES[moduleType], options.projectRoot, templateOptions);
  }

  if (templateOptions.project.cpp) {
    copyDir(tree, CPP_FILES, options.projectRoot, templateOptions);
    tree.delete(
      path.join(options.projectRoot, 'ios', `${templateOptions.project.name}.m`)
    );
  }

  copyDir(tree, NATIVE_COMMON_FILES, options.projectRoot, templateOptions);
  if (moduleType === 'module') {
    copyDir(
      tree,
      NATIVE_FILES[`${moduleType}_${architecture}`],
      options.projectRoot,
      templateOptions
    );
  } else {
    copyDir(
      tree,
      NATIVE_FILES[moduleType],
      options.projectRoot,
      templateOptions
    );
  }

  generateFiles(
    tree, // the virtual file system
    joinPathFragments(__dirname, './files'), // path to the file templates)
    options.projectRoot, // destination path of the files
    { ...templateOptions, template: '' } // config object to replace variable in file templates
  );

  // Delete NX generated index.ts file and replace it with index.tsx
  tree.delete(path.join(options.projectRoot, 'src/index.ts'));
  tree.rename(
    path.join(options.projectRoot, 'src/index.tsx'),
    path.join(options.projectRoot, 'src/index.ts')
  );

  await formatFiles(tree);

  return () => {
    installPackagesTask(tree);
  };
}

// Generate files from templates to Tree
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const copyDir = (tree: Tree, source: string, dest: string, options: any) => {
  const files = readdirSync(source);

  for (const f of files) {
    const target = path.join(
      dest,
      ejs.render(f.replace(/^\$/, ''), options, {
        openDelimiter: '{',
        closeDelimiter: '}',
      })
    );

    const file = path.join(source, f);
    const stats = statSync(file);

    if (stats.isDirectory()) {
      copyDir(tree, file, target, options);
    } else if (!file.match(BINARIES)) {
      const template = readFileSync(file, 'utf8');
      try {
        const newContent = ejs.render(template, options, {});
        tree.write(target, newContent);
      } catch (e) {
        logger.error(`Error in ${file.replace(`${tree.root}/`, '')}:`);
        throw e;
      }
    } else {
      tree.write(file, target);
    }
  }
};

/**
 * Extracts specified directory from a given tarball to the specified destination.
 * @param tarballPath The path to the tarball from where the file should be extracted.
 * @param directory The path to the directory inside the tarball.
 * @param destinationFilePath The destination file path.
 */
export async function extractDirectoryFromTarball(
  tarballPath: string,
  directory: string,
  destinationFilePath: string
) {
  return new Promise<boolean>((resolve, reject) => {
    ensureDirSync(destinationFilePath);
    const tarExtractStream = tar.extract({
      filter: (path) => path.includes(directory),
      cwd: destinationFilePath,
      strip: 2,
    });
    const gunzip = createGunzip();
    gunzip.on('error', reject);
    tarExtractStream.on('error', reject);

    createReadStream(tarballPath).pipe(gunzip).pipe(tarExtractStream);

    tarExtractStream.on('finish', resolve);
  });
}
