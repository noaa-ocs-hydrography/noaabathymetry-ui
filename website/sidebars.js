/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  userGuide: [
    'intro',
    'installation',
    'getting-started',
    {
      type: 'category',
      label: 'Features',
      collapsed: false,
      items: [
        'features/explore-map',
        'features/fetch-tiles',
        'features/build-mosaics',
        'features/export-projects',
      ],
    },
    'troubleshooting',
  ],
};

export default sidebars;
