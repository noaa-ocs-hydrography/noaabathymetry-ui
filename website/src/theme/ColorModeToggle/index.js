import React from 'react';
import clsx from 'clsx';
import useIsBrowser from '@docusaurus/useIsBrowser';
import {translate} from '@docusaurus/Translate';
import IconLightMode from '@theme/Icon/LightMode';
import IconDarkMode from '@theme/Icon/DarkMode';
import styles from '@docusaurus/theme-classic/lib/theme/ColorModeToggle/styles.module.css';

function getNextColorMode(colorMode) {
  return colorMode === 'dark' ? 'light' : 'dark';
}

function getColorModeAriaLabel(colorMode) {
  return translate(
    {
      message: 'Switch between dark and light mode (currently {mode})',
      id: 'theme.colorToggle.ariaLabel',
      description: 'The ARIA label for the color mode toggle',
    },
    {
      mode: colorMode === 'dark' ? 'dark mode' : 'light mode',
    },
  );
}

function ColorModeToggle({
  className,
  buttonClassName,
  value,
  onChange,
}) {
  const isBrowser = useIsBrowser();
  return (
    <div className={clsx(styles.toggle, className)}>
      <button
        className={clsx(
          'clean-btn',
          styles.toggleButton,
          !isBrowser && styles.toggleButtonDisabled,
          buttonClassName,
        )}
        type="button"
        onClick={() => onChange(getNextColorMode(value))}
        disabled={!isBrowser}
        aria-label={getColorModeAriaLabel(value)}>
        <IconLightMode
          aria-hidden
          className={clsx(styles.toggleIcon, styles.lightToggleIcon)}
        />
        <IconDarkMode
          aria-hidden
          className={clsx(styles.toggleIcon, styles.darkToggleIcon)}
        />
      </button>
    </div>
  );
}

export default React.memo(ColorModeToggle);
