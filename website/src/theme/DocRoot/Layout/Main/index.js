import React from 'react';
import clsx from 'clsx';
import {useDocsSidebar} from '@docusaurus/plugin-content-docs/client';
import MobileDocNav from '@site/src/components/MobileDocNav';
import styles from '@docusaurus/theme-classic/lib/theme/DocRoot/Layout/Main/styles.module.css';

export default function DocRootLayoutMain({hiddenSidebarContainer, children}) {
  const sidebar = useDocsSidebar();
  return (
    <main
      className={clsx(
        styles.docMainContainer,
        (hiddenSidebarContainer || !sidebar) && styles.docMainContainerEnhanced,
      )}>
      <div
        className={clsx(
          'container padding-top--md padding-bottom--lg',
          styles.docItemWrapper,
          hiddenSidebarContainer && styles.docItemWrapperEnhanced,
        )}>
        <MobileDocNav />
        {children}
      </div>
    </main>
  );
}
