import { isDesktop } from './tauriBridge';

if (isDesktop) {
  import('./main.desktop');
} else {
  import('./main.web');
}
