import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'NOAA Bathymetry UI',
  tagline: 'Get the latest and best public bathymetry',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://noaa-ocs-hydrography.github.io',
  baseUrl: '/noaabathymetry-ui/',

  organizationName: 'noaa-ocs-hydrography',
  projectName: 'noaabathymetry-ui',
  trailingSlash: false,

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        defaultMode: 'dark',
        disableSwitch: true,
        respectPrefersColorScheme: false,
      },
      navbar: {
        title: 'NOAA Bathymetry UI',
        logo: {
          alt: 'Home',
          src: 'img/NOAA-1.png',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'userGuide',
            position: 'left',
            label: 'User Guide',
          },
          {
            type: 'doc',
            docId: 'about-nbs',
            position: 'left',
            label: 'About NBS',
          },
          {
            href: 'https://github.com/noaa-ocs-hydrography/noaabathymetry-ui',
            position: 'right',
            className: 'header-github-link',
            'aria-label': 'GitHub repository',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Documentation',
            items: [
              { label: 'Getting Started', to: '/docs/getting-started' },
              { label: 'Installation', to: '/docs/installation' },
            ],
          },
          {
            title: 'More',
            items: [
              { label: 'noaabathymetry-ui', href: 'https://github.com/noaa-ocs-hydrography/noaabathymetry-ui' },
              { label: 'noaabathymetry', href: 'https://github.com/noaa-ocs-hydrography/noaabathymetry' },
              { label: 'National Bathymetric Source', href: 'https://nauticalcharts.noaa.gov/learn/nbs.html' },
            ],
          },
        ],
        copyright: `CC0-1.0 — noaabathymetry-ui`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;
