import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import ictusData from '../assets/data/data.json'
import comarcasData from '../assets/data/comarcas.json' // ← ya lo tenías importado

export default function HeatmapRecorridos({ map, activeView }) {
  const activeViewRef = useRef(activeView)
  useEffect(() => {
    activeViewRef.current = activeView
  }, [activeView])

  const markersRef = useRef([])

  useEffect(() => {
    if (!map) return

    const setupLayers = () => {
      const hospitalesVistos = new Set()
      const vis = activeViewRef.current === 'recorridos' ? 'visible' : 'none'

      ictusData.features.forEach((feature, index) => {
        const amb = feature.properties.ambulancia_actual
        const sourceId = `ruta-comarca-${index}`
        const layerId = `ruta-line-${index}`
        const pointsourceId = `puntos-comarca-${index}`
        const pointLayerId = `puntos-line-${index}`

        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [
                  amb.origen.coords,
                  ...amb.ruta_coords,
                  amb.desti.coords
                ]
              }
            }
          })
        }

        const hadLineLayer = !!map.getLayer(layerId)
        if (!hadLineLayer) {
          map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: { visibility: vis },
            paint: {
              'line-color': '#ff0000',
              'line-width': 2
            }
          })
        }

        if (hadLineLayer) return

        if (!map.getSource(pointsourceId)) {
          map.addSource(pointsourceId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: amb.origen.coords
              }
            }
          })
        }

        if (!map.getLayer(pointLayerId)) {
          map.addLayer({
            id: pointLayerId,
            type: 'circle',
            source: pointsourceId,
            layout: {
              'visibility': activeView === 'recorridos' ? 'visible' : 'none'
            },
            paint: {
              'circle-radius': 6,
              'circle-color': '#00ff00'
            }
          })
        }

        const hospitalKey = amb.desti.nom
        if (!hospitalesVistos.has(hospitalKey)) {
          hospitalesVistos.add(hospitalKey)
          const markerDesti = new mapboxgl.Marker({ color: 'blue' })
            .setLngLat(amb.desti.coords)
            .addTo(map)
          markersRef.current.push(markerDesti)
          markerDesti.getElement().style.display = activeView === 'recorridos' ? '' : 'none'
        }
      })

      // ── CAMBIO 1: Añadimos el source y layer de comarcas aquí dentro de setupLayers,
      //    junto al resto de layers. Así se registran todos a la vez cuando el mapa
      //    está listo, y el cleanup los elimina también todos juntos al desmontar.
      if (!map.getSource('comarcas-poligons')) {
        map.addSource('comarcas-poligons', {
          type: 'geojson',
          data: comarcasData
        })
      }

      if (!map.getLayer('comarcas-fill-invisible')) {
        map.addLayer({
          id: 'comarcas-fill-invisible',
          type: 'fill',
          source: 'comarcas-poligons',
          paint: {
            // ── CAMBIO 2: opacity 0 porque este layer no debe verse nunca.
            //    Solo existe para que queryRenderedFeatures pueda detectar
            //    qué comarca hay debajo del cursor al hacer click.
            'fill-opacity': 0
          }
        })
      }
    }

    const runSetup = () => {
      if (!map) return
      setupLayers()
    }

    if (map.isStyleLoaded()) {
      runSetup()
    } else {
      map.once('load', runSetup)
    }

    const t = window.setTimeout(() => {
      if (map?.isStyleLoaded()) {
        runSetup()
      }
    }, 0)

    return () => {
      clearTimeout(t)
      ictusData.features.forEach((_, index) => {
        const sourceId = `ruta-comarca-${index}`
        const layerId = `ruta-line-${index}`
        const pointsourceId = `puntos-comarca-${index}`
        const pointLayerId = `puntos-line-${index}`
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
        if (map.getLayer(pointLayerId)) map.removeLayer(pointLayerId)
        if (map.getSource(pointsourceId)) map.removeSource(pointsourceId)
      })
      markersRef.current.forEach(m => m.remove())
      markersRef.current = []

      // ── CAMBIO 3: Limpiamos también el layer y source de comarcas en el cleanup,
      //    igual que haces con el resto. Si no, Mapbox da error al remontar
      //    el componente porque intenta añadir un source que ya existe.
      if (map.getLayer('comarcas-fill-invisible')) map.removeLayer('comarcas-fill-invisible')
      if (map.getSource('comarcas-poligons')) map.removeSource('comarcas-poligons')
    }
  }, [map])

  useEffect(() => {
    if (!map) return

    const isVisible = activeView === 'recorridos'

    ictusData.features.forEach((_, index) => {
      const layerId = `ruta-line-${index}`
      const pointLayerId = `puntos-line-${index}`
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none')
      }
      if (map.getLayer(pointLayerId)) {
        map.setLayoutProperty(pointLayerId, 'visibility', isVisible ? 'visible' : 'none')
      }

      markersRef.current.forEach(marker => {
        const el = marker.getElement()
        el.style.display = isVisible ? '' : 'none'
      })
    })
  }, [activeView, map])

  // ── CAMBIO 4: Sustituimos el useEffect del fitBounds que no funcionaba.
  //    El anterior cogía cualquier feature del mapa (calles, etiquetas, puntos...)
  //    y su geometría era un Point, así que el bounds era de tamaño cero.
  //    Ahora filtramos SOLO por 'comarcas-fill-invisible' para garantizar que
  //    siempre cogemos un Polygon/MultiPolygon con coordenadas reales.
  useEffect(() => {
    if (!map) return

    const handleMapClick = (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ['comarcas-fill-invisible']
      })
      if (!features.length) return

      const geometry = features[0].geometry
      let coords = []

      if (geometry.type === 'Polygon') {
        coords = geometry.coordinates[0]
      } else if (geometry.type === 'MultiPolygon') {
        // ── CAMBIO 5: flat(2) aplana [[[[lng,lat]]]] → [[lng,lat]]
        //    necesario porque MultiPolygon tiene 3 niveles de arrays anidados.
        coords = geometry.coordinates.flat(2)
      }

      if (!coords.length) return

      const bounds = new mapboxgl.LngLatBounds(coords[0], coords[0])
      coords.forEach(c => bounds.extend(c))

      map.fitBounds(bounds, {
        padding: 60,
        // ── CAMBIO 6: maxZoom a 13 en vez de 100. Con 100 el mapa hacía
        //    zoom extremo en comarcas pequeñas como el Barcelonès.
        //    Con 13 se ve la comarca entera con contexto suficiente.
        maxZoom: 13,
        duration: 1500,
        essential: true
      })
    }

    map.on('click', handleMapClick)
    return () => map.off('click', handleMapClick)
  }, [map])

  return null
}