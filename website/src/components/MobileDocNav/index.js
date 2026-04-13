import React, {useState} from 'react';
import {useDocsSidebar} from '@docusaurus/plugin-content-docs/client';
import {useLocation} from '@docusaurus/router';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

function flattenItems(items, inCategory = false) {
  const result = [];
  for (const item of items) {
    if (item.type === 'link') {
      result.push({...item, inCategory});
    } else if (item.type === 'category') {
      result.push({type: 'category-label', label: item.label});
      result.push(...flattenItems(item.items, true));
    }
  }
  return result;
}

export default function MobileDocNav() {
  const sidebar = useDocsSidebar();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  if (!sidebar) return null;

  const items = flattenItems(sidebar.items);
  const current = items.find(
    (item) => item.type === 'link' && item.href === location.pathname,
  );

  return (
    <div className={styles.mobileNav}>
      <button
        className={styles.mobileNavToggle}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span>{current?.label || 'Navigate'}</span>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}>&#x25BE;</span>
      </button>
      {open && (
        <div className={styles.mobileNavDropdown}>
          {items.map((item, idx) =>
            item.type === 'category-label' ? (
              <div key={idx} className={styles.categoryLabel}>{item.label}</div>
            ) : (
              <Link
                key={idx}
                to={item.href}
                className={`${styles.navLink} ${item.inCategory ? styles.navLinkIndented : ''} ${item.href === location.pathname ? styles.navLinkActive : ''}`}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ),
          )}
        </div>
      )}
    </div>
  );
}
