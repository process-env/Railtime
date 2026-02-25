export default function MapLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link
        rel="preload"
        href="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        as="fetch"
        crossOrigin="anonymous"
      />
      <link
        rel="preload"
        href="/map/nyc-subway-lines.geojson"
        as="fetch"
        crossOrigin="anonymous"
      />
      {children}
    </>
  );
}
