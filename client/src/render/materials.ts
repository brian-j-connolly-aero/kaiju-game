/**
 * The client's shared materials. Models name their materials (`vcol`, `glow`, `city_atlas`:
 * docs/ASSETS.md section 3) and get these instances, so the whole scene is lit and fogged the
 * same way: flat shading, vertex colors, no shadow maps.
 */

import * as THREE from 'three';
import type { AssetStore } from '../assets/assetStore';
import type { MaterialKind } from '../assets/rigModel';

export interface Materials {
  /** Lit, colored by vertex color. */
  vcol: THREE.MeshLambertMaterial;
  /** Unlit and bright: eyes, weak points, lights. */
  glow: THREE.MeshBasicMaterial;
  /** Lit, textured from the shared city atlas. */
  cityAtlas: THREE.MeshLambertMaterial;
  /** Lit vertex colors where the instance color only paints the faces masked by vertex alpha (cars). */
  paint: THREE.MeshLambertMaterial;
  /** Placeholder buildings: a repeating window tile tinted by vertex and instance color. */
  building: THREE.MeshLambertMaterial;
  byKind(kind: MaterialKind): THREE.Material;
  /** 0 by day, 1 at night: lights the windows. */
  setNight(amount: number): void;
}

/**
 * Makes the per-instance color apply only where the vertex color's alpha says "paint"
 * (ASSETS.md manifests: `tint`). Everything else keeps its own color.
 */
function maskInstanceColor(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <color_vertex>',
      [
        '#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )',
        '  vColor = vec4( 1.0 );',
        '#endif',
        '#ifdef USE_COLOR_ALPHA',
        '  vColor *= color;',
        '  #ifdef USE_INSTANCING_COLOR',
        '    vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, color.a );',
        '  #endif',
        '#elif defined( USE_COLOR )',
        '  vColor.rgb *= color;',
        '  #ifdef USE_INSTANCING_COLOR',
        '    vColor.rgb *= instanceColor.rgb;',
        '  #endif',
        '#endif',
      ].join('\n'),
    );
  };
  material.customProgramCacheKey = () => 'mb-paint-mask';
}

export function createMaterials(assets: AssetStore): Materials {
  const vcol = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  vcol.name = 'vcol';
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  glow.name = 'glow';
  const cityAtlas = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    map: assets.texture('city_atlas'),
    emissiveMap: assets.texture('city_atlas_emissive'),
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0,
  });
  cityAtlas.name = 'city_atlas';
  const paint = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  paint.name = 'paint';
  maskInstanceColor(paint);
  const building = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    map: assets.texture('window_tile'),
    emissiveMap: assets.texture('window_tile_lit'),
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0,
  });
  building.name = 'building';

  return {
    vcol,
    glow,
    cityAtlas,
    paint,
    building,
    byKind(kind) {
      return kind === 'glow' ? glow : kind === 'city_atlas' ? cityAtlas : vcol;
    },
    setNight(amount) {
      cityAtlas.emissiveIntensity = amount;
      building.emissiveIntensity = amount * 0.9;
    },
  };
}
