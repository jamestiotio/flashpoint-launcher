import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { AdditionalApp } from './AdditionalApp';

@Entity()
export class Game {
  @PrimaryGeneratedColumn('uuid')
  /** ID of the game (unique identifier) */
  id: string;

  @Column({collation: 'NOCASE'})
  /** Full title of the game */
  title: string;

  @Column({collation: 'NOCASE'})
  /** Any alternate titles to match against search */
  alternateTitles: string;

  @Column({collation: 'NOCASE'})
  /** Game series the game belongs to (empty string if none) */
  series: string;

  @Column({collation: 'NOCASE'})
  /** Name of the developer(s) of the game (developer names are separated by ',') */
  developer: string;

  @Column({collation: 'NOCASE'})
  /** Name of the publisher of the game */
  publisher: string;

  @CreateDateColumn()
  /** Date-time of when the game was added to collection */
  dateAdded: string;

  @UpdateDateColumn()
  /** Date-time of when the game was added to collection */
  dateModified: string;

  @Column({collation: 'NOCASE'})
  /** Platform the game runs on (Flash, HTML5, Shockwave etc.) */
  platform: string;

  @Column()
  /** If the game is "broken" or not */
  broken: boolean;

  @Column()
  /** Game is not suitable for children */
  extreme: boolean;

  @Column({collation: 'NOCASE'})
  /** If the game is single player or multiplayer, and if the multiplayer is cooperative or not */
  playMode: string;

  @Column({collation: 'NOCASE'})
  /** How playable the game is */
  status: string;

  @Column({collation: 'NOCASE'})
  /** Information that could be useful for the player (of varying importance) */
  notes: string;

  @Column({collation: 'NOCASE'})
  /** Tags of the game (seperated by semi-colon) */
  tags: string;

  @Column({collation: 'NOCASE'})
  /** Source if the game files, either full URL or the name of the website */
  source: string;

  @Column()
  /** Path to the application that runs the game */
  applicationPath: string;

  @Column()
  /** Command line argument(s) passed to the application to launch the game */
  launchCommand: string;

  @Column({collation: 'NOCASE'})
  /** Date of when the game was released */
  releaseDate: string;

  @Column({collation: 'NOCASE'})
  /** Version of the game */
  version: string;

  @Column({collation: 'NOCASE'})
  /** Original description of the game (probably given by the game's creator or publisher) */
  originalDescription: string;

  @Column({collation: 'NOCASE'})
  /** The language(s) the game is in */
  language: string;

  @Column({collation: 'NOCASE'})
  /** Library this game belongs to */
  library: string;

  @Column({collation: 'NOCASE'})
  /** The title but reconstructed to be suitable for sorting and ordering (and not be shown visually) */
  orderTitle: string;

  @OneToMany(type => AdditionalApp, addApp => addApp.parentGame, {
    eager: true,
    cascade: true
  })
  /** All attached Additional Apps of a game */
  addApps: AdditionalApp[];

  /** If the game is a placeholder (and can therefore not be saved) */
  placeholder: boolean;
}