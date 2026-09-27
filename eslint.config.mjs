import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          // Layering (see CLAUDE.md §4):
          //   layer:core     – shared kernel, depends on nothing else
          //   layer:platform – cross-cutting platform services (auth, audit, documents, …)
          //   layer:domain   – healthcare domains; never import another domain directly
          depConstraints: [
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['type:lib'],
            },
            {
              sourceTag: 'layer:core',
              onlyDependOnLibsWithTags: ['layer:core'],
            },
            {
              sourceTag: 'layer:platform',
              onlyDependOnLibsWithTags: ['layer:core', 'layer:platform'],
            },
            {
              sourceTag: 'layer:domain',
              onlyDependOnLibsWithTags: ['layer:core', 'layer:platform', 'type:contract'],
            },
            // Platform services may not reach into each other except through
            // these explicit edges: auth → organization, anything → audit.
            {
              sourceTag: 'scope:audit',
              notDependOnLibsWithTags: ['scope:auth', 'scope:organization', 'scope:documents', 'scope:notification'],
            },
            { sourceTag: 'scope:auth', notDependOnLibsWithTags: ['scope:documents', 'scope:notification'] },
            { sourceTag: 'scope:organization', notDependOnLibsWithTags: ['scope:auth', 'scope:documents', 'scope:notification'] },
            { sourceTag: 'scope:documents', notDependOnLibsWithTags: ['scope:auth', 'scope:organization', 'scope:notification'] },
            { sourceTag: 'scope:notification', notDependOnLibsWithTags: ['scope:auth', 'scope:organization', 'scope:documents'] },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts', '**/*.js', '**/*.jsx', '**/*.cjs', '**/*.mjs'],
    // Override or add rules here
    rules: {},
  },
];
