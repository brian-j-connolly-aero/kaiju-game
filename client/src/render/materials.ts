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
   * The city atlas for instanced buildings, painted through the model's three-level mask in its
   * vertex color alpha (docs/art/client-notes-city.md section 2): the instance color paints the
   * wall faces (alpha above 0.75), the per-instance `instanceRoof` the roof faces (0.25 to 0.75:
   * the district's roof color), and the per-instance `instanceShade` darkens everything. Opaque,
   * always: alpha-0 faces must not vanish.
   */
  cityTint: THREE.MeshLambertMaterial;
  /** Lit vertex colors where the instance color only paints the faces masked by vertex alpha (cars). */
  paint: THREE.MeshLambertMaterial;
  /** Placeholder buildings: a repeating window tile tinted by vertex and instance color. */
  building: THREE.MeshLambertMaterial;
  /**
   * The kaiju's body: `vcol` plus a rim of moonlight and a little of its own color at night, so
   * the titan reads as an orange creature against a dark city, not as a black shape. (Each
   * kaiju view draws with its own `kaijuSkin()`; this one never glows.)
   */
  kaiju: THREE.MeshLambertMaterial;
  /**
   * A kaiju body material of its own for one kaiju view: the shared rim light, plus its own
   * glow (phase 3): the stripes the models mark (vertex color alpha 0.25 to 0.75,
   * docs/ASSETS.md section 3) glow in `stripe`, and `flash` lights the whole hide (the power
   * surge's bursts). Both are linear colors at any brightness; black is off.
   */
  kaijuSkin(): KaijuSkin;
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
/** Name of the per-instance color attribute `cityTint` paints roof faces with (1, 1, 1 = as built). */
export const INSTANCE_ROOF = 'instanceRoof';

/**
 * The paint mask's levels in a building's vertex color alpha (docs/art/client-notes-city.md
 * section 2), read with margins: above `wall` the face is a wall that takes the building's
 * color, from `roof` up to `wall` a roof that takes the district's roof color, below `roof`
 * the art's own color. The files hold exact 0, 0.5 and 1 (a copy squeezed into bytes, 128/255).
 */
export const PAINT_MASK = { wall: 0.75, roof: 0.25 } as const;

/** Which paint a face with mask value `a` takes: 'wall', 'roof' or 'none' (the shader's rule, for the CPU side). */
export function maskLevel(a: number): 'wall' | 'roof' | 'none' {
  return a >= PAINT_MASK.wall ? 'wall' : a >= PAINT_MASK.roof ? 'roof' : 'none';
}

/** `cityTint`: the wall paint and the roof paint through the three-level mask, plus a shade for every face. */
function maskInstanceColorWithShade(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n#ifdef USE_INSTANCING\nattribute float ${INSTANCE_SHADE};\nattribute vec3 ${INSTANCE_ROOF};\n#endif`)
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
          `    float mbWall = step( ${PAINT_MASK.wall.toFixed(2)}, color.a );`,
          `    float mbRoof = step( ${PAINT_MASK.roof.toFixed(2)}, color.a ) * ( 1.0 - mbWall );`,
          `    vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, mbWall ) * mix( vec3( 1.0 ), ${INSTANCE_ROOF}, mbRoof ) * ${INSTANCE_SHADE};`,
          '  #else',
          `    vColor.rgb *= instanceColor.rgb * ${INSTANCE_SHADE};`,
          '  #endif',
          '#endif',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'mb-city-tint-roof';
}

/** One kaiju view's body material and its glow (`Materials.kaijuSkin`). */
export interface KaijuSkin {
  material: THREE.MeshLambertMaterial;
  /** What the marked stripes glow with (linear; black: off). */
  stripe: THREE.Color;
  /** Light over the whole hide (linear; black: off). */
  flash: THREE.Color;
}

/** The stripe mark in a kaiju model's vertex color alpha: from 0.25 to 0.75 (written 0.5; the hide is 1). */
export const STRIPE_MASK = { from: 0.25, to: 0.75 } as const;

type RimUniforms = { rimColor: { value: THREE.Color }; rimStrength: { value: number }; selfLift: { value: number } };

/**
 * A kaiju body material: Lambert with vertex colors, a rim light and a self-lift (the shared
 * `rim` uniforms, which `setNight` drives for every kaiju at once) and its own glow: `stripe` on
 * the faces the stripe mark picks out, `flash` everywhere.
 */
function kaijuSkinMaterial(rim: RimUniforms): KaijuSkin {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  material.name = 'kaiju';
  const stripe = { value: new THREE.Color(0, 0, 0) };
  const flash = { value: new THREE.Color(0, 0, 0) };
  const uniforms = { ...rim, stripeGlow: stripe, hideFlash: flash };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;\nuniform float rimStrength;\nuniform float selfLift;\nuniform vec3 stripeGlow;\nuniform vec3 hideFlash;')
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          '{',
          '  float facing = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );',
          '  float rim = 1.0 - facing;',
          '  totalEmissiveRadiance += rimColor * ( rimStrength * rim * rim * rim ) + diffuseColor.rgb * selfLift + hideFlash;',
          '  #ifdef USE_COLOR_ALPHA',
          `    float mbStripe = step( ${STRIPE_MASK.from.toFixed(2)}, vColor.a ) * ( 1.0 - step( ${STRIPE_MASK.to.toFixed(2)}, vColor.a ) );`,
          '    totalEmissiveRadiance += stripeGlow * mbStripe;',
          '  #endif',
          '}',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'mb-kaiju-skin';
  return { material, stripe: stripe.value, flash: flash.value };
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
  const rim: RimUniforms = { rimColor: { value: new THREE.Color(0x9db8ff) }, rimStrength: { value: 0 }, selfLift: { value: 0 } };
  const kaiju = kaijuSkinMaterial(rim).material;
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
    kaijuSkin: () => kaijuSkinMaterial(rim),
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
