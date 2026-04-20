import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import comarcasData from '../assets/data/comarcas.json'
import ictusData from '../assets/data/data.json'


const lookup = {}
ictusData.features.forEach(f => {
  lookup[f.properties.comarca] = f.properties
})

comarcasData.features.forEach(f => {
  const datos = lookup[f.properties.NOMCOMAR]
  if (datos) {
    f.properties.casos_ictus = datos.casos_ictus_any
    f.properties.poblacio    = datos.poblacio
  }
})

export default function HeatmapCasos({ map }) {
  const tooltip = useRef(new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false
  }))

  useEffect(() => {
    if (!map.current) return

    map.current.on('load', () => {

      map.current.addSource('comarcas', {
        type: 'geojson',
        data: comarcasData,
      })

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
      })

      map.current.addLayer({
        id: 'comarcas-line',
        type: 'line',
        source: 'comarcas',
        paint: {
          'line-color': '#534AB7',
          'line-width': 1.2
        }
      })

      map.current.on('mouseenter', 'comarcas-fill', () => {
        map.current.getCanvas().style.cursor = 'pointer'
      })

      map.current.on('mousemove', 'comarcas-fill', (e) => {
        if (e.features.length === 0) return
        const { NOMCOMAR, casos_ictus, poblacio } = e.features[0].properties
        tooltip.current
          .setLngLat(e.lngLat)
          .setHTML(`
            <strong>${NOMCOMAR}</strong><br/>
            Població: ${poblacio ?? 'N/A'}<br/>
            Casos ictus: ${casos_ictus ?? 'N/A'}
          `)
          .addTo(map.current)
      })

      map.current.on('mouseleave', 'comarcas-fill', () => {
        tooltip.current.remove()
        map.current.getCanvas().style.cursor = ''
      })

    })
  }, [])

  return null
}