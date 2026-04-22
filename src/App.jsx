import mapboxgl from 'mapbox-gl'
import { useEffect, useRef, useState } from 'react'
import './App.css'
import 'mapbox-gl/dist/mapbox-gl.css'
import HeatmapCasos from './maps/HeatmapCasos'
import HeatmapBurbuja from './maps/HeatmapBurbuja'
import HeatmapRecorridos from './maps/HeatmapRecorridos'
import comarcasData from './assets/data/comarcas.json'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

function App() {
  const mapContainer = useRef(null)
  const map = useRef(null)

  const [activeView, setActiveView]= useState(null);

  useEffect(() => {
    if (map.current) return

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [1.5, 41.8],
      zoom: 7,
    })

    if (map.current.isStyleLoaded()) setupComarcas()
    else map.current.on('load', setupComarcas)
    
  }, [])

  const setupComarcas = () => {
    if (!map.current.getSource('comarcas')) {
       map.current.addSource('comarcas', { type: 'geojson', data: comarcasData })
    }

    map.current.addLayer({
      id: 'comarcas-line',
      type: 'line',
      source: 'comarcas',
      paint: { 'line-color': '#534AB7', 'line-width': 1, 'line-opacity': 1 }
    })
  }

  return (
    <div className="App">
      <div>
        <button onClick={() => {setActiveView(null)}}>Sin filtrar</button> 
        <button onClick={() => {setActiveView('heatmap')}}>Mapa de calor</button> 
        <button onClick={() => {setActiveView('burbujas')}}>Mapa de burbujas</button>
        <button onClick={() => {setActiveView('recorridos')}}>Mapa de recorridos</button>
      </div>
      <div ref={mapContainer} className="map-container" />
      <HeatmapCasos map={map} activeView={activeView}/>
      <HeatmapBurbuja map={map} activeView={activeView}/>
      <HeatmapRecorridos map={map} activeView={activeView}/>
      </div>
  )
}

export default App