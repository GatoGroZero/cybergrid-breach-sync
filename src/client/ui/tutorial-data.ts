import type { Action } from '../game/input';
import { keyLabel } from '../game/input';

/** Una seccion del tutorial de la Aventura: un dibujito, un titulo y unas lineas cortas. */
export interface TutorialSection {
  id: string;
  title: string;
  icon: 'gato' | 'arma' | 'cura' | 'puerta' | 'jefe' | 'poder' | 'reliquia' | 'vida' | 'esencia';
  lines: string[];
}

type Keys = Record<Action, string>;

/** Las teclas que el jugador tiene puestas, para que el texto diga las suyas. */
export const tutorialKeys = (keys: Keys, a: Action): string => keyLabel(keys[a]);

/** El contenido completo, con las teclas reales de quien lo lee. */
export function tutorialSections(keys: Keys): TutorialSection[] {
  const k = (a: Action): string => tutorialKeys(keys, a);
  return [
    {
      id: 'meta',
      title: 'De qué trata',
      icon: 'gato',
      lines: [
        'Explora el bosque encantado: no hay un solo camino. Tú decides a dónde ir y tarde o temprano llegarás al trono del Rey Gato de las Sombras.',
        'Juegan de 1 a 4 gatos, todos del mismo equipo. Entre más amigos, más enemigos, pero también más botín.',
        'En cada sala hay oleadas de enemigos. Al vencerlas se abren las puertas de enredadera. Entre más lejos del inicio, más duro: explora y farmea antes de buscar al jefe final.',
      ],
    },
    {
      id: 'moverse',
      title: 'Moverte y esquivar',
      icon: 'gato',
      lines: [
        `PC: ${k('up')}${k('left')}${k('down')}${k('right')} o las flechas para moverte, ${k('run')} para correr.`,
        `Voltereta: ${k('dash')} (PC) o el botón de la flecha curva (celular). Te hace esquivar y por un instante nada te golpea.`,
        'Celular: joystick izquierdo para moverte; empújalo hasta el aro punteado para correr.',
        'Cuando aparece un círculo o una franja roja en el suelo, sal de ahí: es el aviso de un ataque.',
      ],
    },
    {
      id: 'pelear',
      title: 'Pelear y usar tus armas',
      icon: 'arma',
      lines: [
        'PC: apunta con el ratón y dispara con el clic o con Espacio. Celular: arrastra el joystick derecho y el arma dispara sola mientras ves la línea.',
        `Recarga con ${k('reload')} (o el botón R). La pistola nunca se queda sin balas.`,
        `Cambia de objeto con 1 a 5 (o tocando la barra de abajo). ${k('interact')} abre cofres y levanta lo que hay en el suelo.`,
        'Cada arma es distinta: la pistola es pareja, el fusil dispara en ráfaga, la escopeta pega fuerte de cerca, la sniper de lejos y la bazuca explota en área.',
        'El color del arma dice qué tan buena es: gris, verde y morada (la mejor).',
      ],
    },
    {
      id: 'curar',
      title: 'Curarte y pociones',
      icon: 'cura',
      lines: [
        'El botiquín te cura poco a poco y el escudo te protege. Con uno en la mano, tócalo otra vez, pulsa USAR o la tecla de interactuar.',
        'La hierba gatera te da más daño y velocidad un rato. La valeriana te vuelve rápido y casi sin espera para la voltereta.',
        'Si cambias de objeto mientras te curas, la cura se cancela.',
      ],
    },
    {
      id: 'salas',
      title: 'Salas y puertas',
      icon: 'puerta',
      lines: [
        'Hay salas de combate, del tesoro (cofres dorados y una reliquia), lugares de descanso (la fuente de leche de luna cura al grupo) y guaridas de minijefe. Los jefes están al fondo de ramas sin salida; el minimapa te muestra por dónde ya pasaste.',
        'Las puertas de enredadera se cierran cuando empieza una pelea y se abren al ganar.',
        'Recoge lo que dejan los enemigos antes de seguir: armas, balas y curas.',
      ],
    },
    {
      id: 'jefes',
      title: 'Jefes y habilidades',
      icon: 'jefe',
      lines: [
        'Hay cinco minijefes y, al final, el Rey Gato. Antes de pelear verás su presentación y después empieza la pelea.',
        'Cada jefe vencido suelta armas, curas y te deja elegir una habilidad nueva (o subirla de nivel).',
        `Las habilidades salen con ${k('power1')}, ${k('power2')} y ${k('power3')} en PC, o con sus botones en el celular. Tienen enfriamiento, así que úsalas en el momento justo.`,
        'Puedes llevar hasta tres habilidades a la vez.',
      ],
    },
    {
      id: 'reliquias',
      title: 'Reliquias y armadura',
      icon: 'reliquia',
      lines: [
        'Al superar salas eliges una reliquia entre varias: más daño, más vida, más velocidad, golpe doble... y se suman unas a otras.',
        'La armadura tiene tres casillas (cabeza, cuerpo y patas) con tres calidades; se equipa sola al recogerla.',
      ],
    },
    {
      id: 'vidas',
      title: 'Vidas del grupo',
      icon: 'vida',
      lines: [
        'El grupo comparte las vidas (arriba, junto al corazón). Si un gato cae, se levanta solo a los pocos segundos mientras queden vidas.',
        'Si te quedas sin vidas, esperas viendo a tus compañeros y vuelves a levantarte al terminar la zona, siempre que alguien siga en pie.',
        'Si todo el grupo cae sin vidas, la aventura termina, pero lo que ganaste no se pierde.',
      ],
    },
    {
      id: 'esencia',
      title: 'Esencia lunar y Santuario',
      icon: 'esencia',
      lines: [
        'Cada partida deja esencia lunar, sobre todo si llegas lejos o ganas.',
        'En el menú, entra al Santuario de la luna y gástala en mejoras que se quedan para siempre: más vida, balas y botiquines iniciales, más esencia, vidas extra y una reliquia de regalo.',
        'Perder también deja esencia: cada intento te hace más fuerte.',
      ],
    },
  ];
}
