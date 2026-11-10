// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    'overview',
    {
      type: 'category',
      label: 'Architecture',
      link: { type: 'doc', id: 'architecture/index' },
      items: ['architecture/login-flow', 'architecture/token-relay', 'architecture/back-channel-logout'],
    },
    {
      type: 'category',
      label: 'Use cases',
      link: { type: 'doc', id: 'use-cases/index' },
      items: ['use-cases/register', 'use-cases/login', 'use-cases/forgot-password', 'use-cases/logout'],
    },
    'technology-stack',
    'api',
    'running-locally',
    {
      type: 'category',
      label: 'Decisions',
      link: { type: 'doc', id: 'decisions/index' },
      items: [
        'decisions/bff-and-token-relay',
        'decisions/sessions-in-redis',
        'decisions/csrf-and-same-origin',
        'decisions/logout',
        'decisions/gateway-hardening',
        'decisions/auth-abuse-protection',
        'decisions/password-reset',
        'decisions/registration-full-name',
        'decisions/realm-as-code',
        'decisions/verification',
        'decisions/docs-site',
      ],
    },
  ],
}

export default sidebars
