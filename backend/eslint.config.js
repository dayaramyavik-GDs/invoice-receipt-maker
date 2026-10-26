const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['coverage/**'] },
  js.configs.recommended,
  { languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } } },
];
