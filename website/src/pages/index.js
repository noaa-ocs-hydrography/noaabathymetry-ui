import React, {useState} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import styles from './index.module.css';

const features = [
  {
    title: 'Explore',
    description: 'Browse NBS bathymetric data',
    link: '/docs/features/explore-map',
  },
  {
    title: 'Fetch',
    description: 'Download tiles to your machine',
    link: '/docs/features/fetch-tiles',
  },
  {
    title: 'Mosaic',
    description: 'Merge tiles into VRT mosaic',
    link: '/docs/features/build-mosaics',
  },
  {
    title: 'Export',
    description: 'Package and share your project',
    link: '/docs/features/export-projects',
  },
];

const platforms = [
  {
    label: 'macOS',
    sub: 'Apple Silicon',
    icon: (<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>),
    url: 'https://github.com/noaa-ocs-hydrography/noaabathymetry-ui/releases/latest/download/noaabathymetry-macOS-ARM.zip',
  },
  {
    label: 'macOS',
    sub: 'Intel',
    icon: (<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>),
    url: 'https://github.com/noaa-ocs-hydrography/noaabathymetry-ui/releases/latest/download/noaabathymetry-macOS-Intel.zip',
  },
  {
    label: 'Windows',
    sub: null,
    icon: (<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M3 12V6.5l8-1.1V12H3zm0 .5h8v6.6l-8-1.1V12.5zM11.5 5.3l9.5-1.3v8.5h-9.5V5.3zM11.5 13h9.5v8l-9.5-1.3V13z"/></svg>),
    url: 'https://github.com/noaa-ocs-hydrography/noaabathymetry-ui/releases/latest/download/noaabathymetry.exe',
  },
];

function Hero() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={styles.hero}>
      <div className="container">
        <div className={styles.heroInner}>
          <div className={styles.heroText}>
            <img src={require('@site/static/img/NOAA-1.png').default} alt="NOAA" className={styles.heroLogo} />
            <p className={styles.heroLabel}>National Bathymetric Source</p>
            <Heading as="h1" className={styles.heroTitle}>
              {siteConfig.title}
            </Heading>
            <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>
          </div>
          {/* TODO: Add back when demo video is ready. This is a placeholder.
          <div className={styles.heroVideo}>
            <iframe
              src="https://www.youtube.com/embed/Gn75Aa1a8Tc"
              title="NOAA Bathymetry UI"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div> */}
        </div>

      </div>
    </header>
  );
}

function Feature({title, description, link}) {
  return (
    <Link className={styles.featureCard} to={link}>
      <Heading as="h3" className={styles.featureTitle}>{title}</Heading>
      <p className={styles.featureDescription}>{description}</p>
    </Link>
  );
}

function Features() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.featuresGrid}>
          {features.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
      <div className={styles.waveFront} />
    </section>
  );
}

function Downloads() {
  return (
    <section className={styles.downloads}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>Download</Heading>
        <p className={styles.sectionSubtitle}>
          No installation or Python environment required. Just download and run.
        </p>
        <div className={styles.downloadLinks}>
          {platforms.map((p, idx) => (
            <a key={idx} className={styles.downloadLink} href={p.url}>
              <span className={styles.downloadIcon}>{p.icon}</span>
              <span>{p.label}</span>
              {p.sub && <span className={styles.downloadSub}>{p.sub}</span>}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

const sources = [
  { name: 'BlueTopo', desc: 'GeoTIFF compilations of the best available public bathymetric data on a national vertical datum' },
  { name: 'Modeling', desc: 'GeoTIFF compilations of the best available public bathymetric data on a low water datum' },
  { name: 'BAG', desc: 'Bathymetric Attributed Grid files on a low water datum' },
  { name: 'S-102 v2.1', desc: 'IHO S-102 version 2.1 on a low water datum||These data are for test and evaluation and should not be used for navigation' },
  { name: 'S-102 v2.2', desc: 'IHO S-102 version 2.2 on a low water datum||These data are for test and evaluation and should not be used for navigation' },
  { name: 'S-102 v3.0', desc: 'IHO S-102 version 3.0 on a low water datum||These data are for test and evaluation and should not be used for navigation' },
];

function DataSources() {
  const [activeDesc, setActiveDesc] = useState(sources[0].desc);
  return (
    <section className={styles.dataSources}>
      <div className="container">
        <p className={styles.sectionSubtitle}>
          Data Sources
        </p>
        <div className={styles.sourcePills}>
          {sources.map((s, idx) => (
            <span
              key={idx}
              className={clsx(styles.sourcePill, activeDesc === s.desc && styles.sourcePillActive)}
              onMouseEnter={() => setActiveDesc(s.desc)}
              onMouseLeave={() => {}}
            >{s.name}</span>
          ))}
        </div>
        <p className={styles.sourceDesc}>
          {activeDesc && activeDesc.includes('||') ? (
            <>
              {activeDesc.split('||')[0]}
              <br />
              <span className={styles.disclaimerText}>{activeDesc.split('||')[1]}</span>
            </>
          ) : (
            activeDesc || '\u00A0'
          )}
        </p>
      </div>
    </section>
  );
}

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <Hero />
      <main>
        <Features />
        <DataSources />
        <Downloads />
      </main>
    </Layout>
  );
}
