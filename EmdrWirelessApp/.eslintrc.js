module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      files: [
        'scripts/generate-otp-secret.js',
        'src/utils/base32.ts',
        'src/utils/base64.ts',
        'src/utils/color.ts',
        'src/utils/totp.ts',
      ],
      rules: {
        'no-bitwise': 'off',
        'no-div-regex': 'off',
      },
    },
  ],
};
