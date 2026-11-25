import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Interstate Homes',
    short_name: 'Interstate',
    description:
      'Internal estimating, subcontractor compliance, purchase orders, and live job cost budget platform for Interstate Homes.',
    start_url: '/',
    display: 'standalone',
    background_color: '#111111',
    theme_color: '#111111',
  };
}
