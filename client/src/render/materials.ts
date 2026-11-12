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
  /**
   * The city atlas for instanced buildings: the instance color paints only the wall faces the
   * model masks (vertex color alpha 1), and the per-instance `instanceShade` darkens everything
   * (docs/art/client-notes-city.md section 2). Opaque, always: alpha-0 faces must not vanish.
   */
  cityTint: THREE.MeshLambertMaterial;
  /** Lit vertex colors where the instance color only paints the faces masked by vertex alpha (cars). */
  paint: THREE.MeshLambertMaterial;
  /** Placeholder buildings: a repeating window tile tinted by vertex and instance color. */
  building: THREE.MeshLambertMaterial;
  /**
   * The kaiju's body: `vcol` plus a rim of moonlight and a little of its own color at night, so
   * the titan reads as an orange creature against a dark city, not as a black shape.
   */
  kaiju: THREE.MeshLambertMaterial;
  byKind(kind: MaterialKind): THREE.Material;
  /**
   * 0 by day, 1 at night: lights the windows and the kaiju's rim. `insideKaiju`: the camera is
   * in the kaiju's head, and its own claws keep the art's colors (no rim on them).
   */
  setNight(amount: number, insideKaiju?: boolean): void;
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

/** Name of the per-instance float attribute `cityTint` reads (1 = as built, below 1 = darker). */
export const INSTANCE_SHADE = 'instanceShade';

/** `cityTint`: masked instance color plus a separate shade for every face. */
function maskInstanceColorWithShade(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n#ifdef USE_INSTANCING\nattribute float ${INSTANCE_SHADE};\n#endif`)
      .replace(
        '#include <color_vertex>',
        [
          '#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )',
          '  vColor = vec4( 1.0 );',
          '#endif',
          '#ifdef USE_COLOR_ALPHA',
          '  vColor *= color;',
          '#elif defined( USE_COLOR )',
          '  vColor.rgb *= color;',
          '#endif',
          '#ifdef USE_INSTANCING_COLOR',
          '  #ifdef USE_COLOR_ALPHA',
          `    vColor.rgb *= mix( vec3( ${INSTANCE_SHADE} ), instanceColor.rgb * ${INSTANCE_SHADE}, color.a );`,
          '  #else',
          `    vColor.rgb *= instanceColor.rgb * ${INSTANCE_SHADE};`,
          '  #endif',
          '#endif',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'mb-city-tint';
}

/** Adds a rim light and a self-lift to a Lambert material; returns the uniforms to drive them. */
function addRimLight(material: THREE.MeshLambertMaterial): { rimColor: { value: THREE.Color }; rimStrength: { value: number }; selfLift: { value: number } } {
  const uniforms = { rimColor: { value: new THREE.Color(0x9db8ff) }, rimStrength: { value: 0 }, selfLift: { value: 0 } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;\nuniform float rimStrength;\nuniform float selfLift;')
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          '{',
          '  float facing = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );',
          '  float rim = 1.0 - facing;',
          '  totalEmissiveRadiance += rimColor * ( rimStrength * rim * rim * rim ) + diffuseColor.rgb * selfLift;',
          '}',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'mb-kaiju-rim';
  return uniforms;
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
  const cityTint = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    map: cityAtlas.map,
    emissiveMap: cityAtlas.emissiveMap,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0,
  });
  cityTint.name = 'city_tint';
  maskInstanceColorWithShade(cityTint);
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
  const kaiju = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  kaiju.name = 'kaiju';
  const rim = addRimLight(kaiju);
  // Kept where a console or a screenshot tool can reach them (to compare with the rim off).
  kaiju.userData.rim = rim;

  return {
    vcol,
    glow,
    cityAtlas,
    cityTint,
    paint,
    building,
    kaiju,
    byKind(kind) {
      return kind === 'glow' ? glow : kind === 'city_atlas' ? cityAtlas : vcol;
    },
    setNight(amount, insideKaiju = false) {
      cityAtlas.emissiveIntensity = amount;
      cityTint.emissiveIntensity = amount;
      building.emissiveIntensity = amount * 0.9;
      // Sunset (0.35): a warm edge; night (1): moonlight round the silhouette and the body's own
      // orange lifted out of the dark.
      rim.rimStrength.value = insideKaiju ? 0 : 0.2 + amount * 0.5;
      rim.selfLift.value = insideKaiju ? 0 : amount * 0.15;
      rim.rimColor.value.setHex(amount > 0.6 ? 0xa8c4ff : 0xffc49a);
    },
  };
}
