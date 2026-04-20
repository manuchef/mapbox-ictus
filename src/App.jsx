import mapboxgl from 'mapbox-gl'
import { useEffect, useRef } from 'react'
import './App.css'
import 'mapbox-gl/dist/mapbox-gl.css'
import HeatmapCasos from './maps/HeatmapCasos'


mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

function App() {
  const mapContainer = useRef(null)
  const map = useRef(null)

  useEffect(() => {
    if (map.current) return

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [1.5, 41.8],
      zoom: 7,
    })
  }, [])

  return (
    <div className="App">
      <div ref={mapContainer} className="map-container" />
      <HeatmapCasos map={map} />
      </div>
  )
}

export default App