import mapboxgl from "mapbox-gl";
import { useEffect, useRef } from "react";
import "./App.css";
import comarcasData from './assets/data/comarcas.json';
import ictusData from './assets/data/data.json';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const lookup = {};
ictusData.features.forEach(f => {
  lookup[f.properties.comarca] = f.properties;
});

comarcasData.features.forEach(f => {
  const datos = lookup[f.properties.NOMCOMAR];
  if (datos) {
    f.properties.casos_ictus = datos.casos_ictus_any;
    f.properties.poblacio    = datos.poblacio;
  }
});

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const tooltip = useRef(new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false
  }));

  // ✅ Ref en lugar de estado — siempre visible dentro del closure del mapa
  const cursorRef = useRef(null);

  useEffect(() => {
    if (map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [1.5, 41.8],
      zoom: 7,
    });

    map.current.on('load', () => {

      map.current.addSource('comarcas', {
        type: 'geojson',
        data: comarcasData,
      });

      map.current.addLayer({
        id: 'comarcas-fill',
        type: 'fill',
        source: 'comarcas',
        paint: {
          'fill-color': [
            'interpolate', ['linear'], ['get', 'casos_ictus'],
            0,   '#fff7ec',
            50,  '#fdd49e',
            100, '#fc8d59',
            200, '#d7301f',
            400, '#7f0000'
          ],
          'fill-opacity': 0.75
        }
      });

      map.current.addLayer({
        id: 'comarcas-line',
        type: 'line',
        source: 'comarcas',
        paint: {
          'line-color': '#534AB7',
          'line-width': 1.2
        }
      });

      map.current.on('mouseenter', 'comarcas-fill', () => {
        map.current.getCanvas().style.cursor = 'pointer';
      });

      map.current.on('mousemove', 'comarcas-fill', (e) => {
        if (e.features.length === 0) return;

        // ✅ Actualiza el ref con las coordenadas actuales
        cursorRef.current = e.lngLat;

        const { NOMCOMAR, casos_ictus, poblacio } = e.features[0].properties;
        

        // ✅ Usa e.lngLat directamente (o cursorRef.current, son lo mismo aquí)
        tooltip.current
          .setLngLat(e.lngLat)
          .setHTML(`
            <strong>${NOMCOMAR}</strong><br/>
            Població: ${poblacio ?? 'N/A'}<br/>
            Casos ictus: ${casos_ictus ?? 'N/A'}
          `)
          .addTo(map.current);
      });

      map.current.on('mouseleave', 'comarcas-fill', () => {
        cursorRef.current = null;
        tooltip.current.remove();
        map.current.getCanvas().style.cursor = '';
      });

    });
  }, []);

  return (
    <div className="App">
      <div ref={mapContainer} className="map-container" />
    </div>
  );
}

export default App;