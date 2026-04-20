import mapboxgl from "mapbox-gl";
import { useEffect, useRef, useState } from "react";
import "./App.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [lng, setLng] = useState(1.5);
  const [lat, setLat] = useState(41.8);
  const [zoom, setZoom] = useState(7);

  useEffect(() => { 
    if (map.current) return;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [lng, lat],
      zoom: zoom,
    });

     map.current.on('load', () => {
      map.current.addSource('comarcas', {
        type: 'geojson',
        data: '/src/assets/data/comarcas.json'      
      });
     
      map.current.addLayer({
        id: 'comarcas-fill',
        type: 'fill',
        source: 'comarcas',
        paint: {
          'fill-color': '#AFA9EC',
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.6, 
            0.2  
          ]
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
    });
  }, []);

  return (
    <div className="App">
      <div ref={mapContainer} className="map-container" />
    </div>
  );
}

export default App;