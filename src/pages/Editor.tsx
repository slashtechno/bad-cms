// imports
import React, { useContext } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import styles from './Editor.module.css';
import { createMachine, assign, interpret } from 'xstate';
import { useMachine } from '@xstate/react';

import CodeEditor, { loader } from "@monaco-editor/react";

import path from 'path';

import { store } from '../store';

const ipc = require('electron').ipcRenderer;

// Editor code (js)
export default function Editor(props) {
    const navigate = useNavigate();
    const projects = store.get('projects', false);
    let { id } = useParams();

    const stateMachine = createMachine({
      id: "editor",
      initial: "loading",
      context: {
        tab: 0,
        editorTabs: [],
        monaco: null,
        editor: null,
        image: null,
      },
      states: {
        loading: {
          on: {
            editorLoaded: {
              target: "editor",
              actions: [
                () => {
                  ipc.send('getFiles', {directory: projects[id].directory});
                },
                assign((context, event: { monaco: any, editor: any }) => {
                  return {
                    monaco: event.monaco,
                    editor: event.editor,
                  }
                })
              ],
            }
          }
        },
        editor: {
          initial: "loading",
          on: {
            setTabs: {
              actions: assign((context, event: { tabs: any }) => {
                return {
                  editorTabs: event.tabs,
                }
              })
            },
            setImage: {
              target: ".image",
              actions: assign((context, event: { image: any }) => {
                return {
                  image: event.image,
                }
              })
            },
            switchTab: [
              {
                target: ".code",
                cond: (context, event) => event.tab >= 0,
    
                actions: assign((context, event: { tab: any }) => {
                  return {
                    tab: event.tab,
                  };
                }),
              },
              {
                target: ".layout",
                cond: (context, event) => event.tab === -2,
    
                actions: assign((context, event: { tab: any }) => {
                  return {
                    tab: event.tab,
                  };
                }),
              },
              {
                target: ".settings",
    
                actions: assign((context, event: { tab: any }) => {
                  return {
                    tab: event.tab,
                  };
                }),
              },
            ],
          },
          states: {
            loading: {
              on: {
                finishedLoading: "code"
              }
            },
            code: {},
            layout: {
              initial: "selectionTab",
              on: {
                selectionTab: {
                  target: ".selectionTab",
                },
                creatorTab: {
                  target: ".creatorTab",
                }
              },
              states: {
                selectionTab: {},
                creatorTab: {}
              }
            },
            image: {},
            settings: {
              initial: "deleteClosed",
              on: {
                openDelete: ".deleteOpen",
                closeDelete: ".deleteClosed",
              },
              states: {
                deleteClosed: {
                  on: {
                    openDelete: "deleteOpen"
                  }
                },
                deleteOpen: {
                  on: {
                    closeDelete: "deleteClosed"
                  }
                }
              }
            },
          },
        },
      },
    });

    const [state, send, service] = useMachine(stateMachine);

    let editor = state.context.editor;
    let monaco = state.context.monaco;
    
    var editorPane = [
      <CodeEditor
        key="editor"
        defaultLanguage="html"
        // language={editorLanguage}
        width="calc(100vw - var(--menu-width))"
        defaultValue="Loading editor..."
        // value={editorCode}
        theme="vs-dark"
        className={styles.editor}
        // onChange={updateEditorChanges}
        onMount={(editorElem, monacoElem) => {
          send("editorLoaded", { monaco: monacoElem, editor: editorElem });
        }}
      />
    ];

    // Remove all IPC listeners when the component is mounted again.
    ipc.removeAllListeners();
    
    ipc.once('getFilesReply', async (event, args) => {
      var loadingSelections = [];
      for(let i = 0; i < args.files.length; i++) {
        loadingSelections.push({
          name: args.files[i],
          window: false
        });
      }
      // Set text in the editor to Loading file...
      while(editor === null) {
        // Wait for the editor to be loaded
        await sleep(50);
      }
      send("setTabs", {tabs: loadingSelections});
      if(state.can('finishedLoading')) send("finishedLoading");
      ipc.send('getFile', {file: path.join(args.directory, args.files[0])});
    });
    
    let editorTabs = state.context.editorTabs;
    let editorTab = state.context.tab;

    let editorName = "Loading";

    let editingMenu = [];

    let wideVersion = false;

    ipc.once('getFileReply', async (event, args) => {
      if(args.isImage) {
        send("setImage", { image: args.file });
      } else {
        while(editor === null) {
          // Wait for the editor to be loaded
          await sleep(50);
          console.log("Waiting for editor to be loaded...");
        }
        let language = null;
        if(args.fileName !== undefined) {
          var extToLang = { // List of compatible files with Monaco language support
            ".html": "html",
            ".css": "css",
            ".js": "javascript",
            ".svg": "html",
          };
  
          language = extToLang[path.extname(args.fileName)];
          language = language === undefined ? "plaintext" : language;
  
          monaco.editor.setModelLanguage(editor.getModel(), language);
        }
        editor.setValue(args.content);
      }
    });

    const selectTab = (tab) => {
      send('switchTab', {tab: tab});
      if(tab >= 0) {
        ipc.send('getFile', {file: path.join(projects[id].directory, editorTabs[tab].name)});
      }
    }

    ipc.once('popoutClose', (event, args) => {
        editorTabs[args].window = false;
        send('setTabs', { tabs: editorTabs });
    });

    const focusWindow = (window) => {
      ipc.send('editorFocusWindow', window);
    }

    const popOut = () => {
      if(editorTab < 0) return;
      ipc.send('editorPopOut', {file: path.join(projects[id].directory, editorTabs[editorTab].name), index: editorTab});
    }
    
    ipc.once('editorPopoutReply', (event, args) => {
      // Select the first tab that isn't popped out.
      editorTabs[args.index].window = args.window;
      send("setTabs", { tabs: editorTabs });
      for(let i = 0; i < editorTabs.length; i++) {
        if(editorTabs[i].window !== false) {
          continue;
        } else {
          selectTab(i);
          break;
        }
      }
    });

    const InjectJS = () => {
      ipc.send('getAppPath');
    }

    const iFrameMessage = (event) => {
      let parsedData;
      try {
        parsedData = JSON.parse(event.data);
      } catch(e) {
        return;
      }
      console.log(parsedData);
      if(parsedData.type === "clickedElement") {
        console.log("Clicked element with classList " + parsedData.classList);
      }
    }

    React.useEffect(() => {
      window.addEventListener('message', iFrameMessage);

      return () => {
        window.removeEventListener('message', iFrameMessage);
      }
    }, []);

    ipc.once('getAppPathReply', (event, args) => {
      var iFrameHead = window.frames["editorFrame"].document.getElementsByTagName("head")[0];
      var myscript = document.createElement('script');
      myscript.type = 'text/javascript';
      myscript.src = path.join(args, '/pages/editorLayoutInjectScript.js');
      iFrameHead.appendChild(myscript);
    });

    const deleteProjectConfirm = () => {
      var currentProjects: any = store.get('projects', []);
      ipc.send('deleteProject', {directory: currentProjects[id].directory});
      currentProjects.splice(id, 1);
      store.set('projects', currentProjects);
    }

    ipc.once('deleteProjectReply', (event, args) => {
      if(args === true) {
        navigate('/');
      } else {
        navigate('/Error', {state: {error: "Error deleting project!", errorMessage: args}});
      }
    });

    if (state.matches("editor.settings")) {
      const isDeleting = state.matches("editor.settings.deleteOpen");

      const deleteMenu = isDeleting ? 
        <div className={styles.confirmDelete}>
          <div className={styles.confirmDeleteContainer}>
            <div className={styles.confirmDeleteText}>Are you sure you want to delete this project? This action is irreversible.</div>
            <div className={styles.confirmDeleteButtons}>
              <button className={`${styles.confirmDeleteButton} ${styles.confirmDeleteButtonCancel}`} onClick={() => send("closeDelete")}>Cancel</button>
              <button className={styles.confirmDeleteButton} onClick={() => deleteProjectConfirm()}>Delete</button>
            </div>
          </div>
      </div> : <></>;

      editingMenu = [
        <div key="settings" className={styles.settingsMenu}>
          <div className={styles.settingsMenuSeparator}>Misc</div>
          <div className={styles.settingsMenuSection}>
            Some sort of settings menu idk
          </div>
          <div className={`${styles.settingsMenuSeparator} ${styles.settingMenuDanger}`}>DANGER ZONE</div>
          <div className={styles.settingsMenuSection}>
            <button className={styles.deleteProjectButton} onClick={() => { send("openDelete") }}>Delete Project</button>
          </div>
          {deleteMenu}
        </div>
      ];
      editorName = "Settings";
    } else if (state.matches("editor.layout")) {
      editingMenu = [
        <div key="layout" className={styles.layoutEditor}> 
          <div className={styles.layoutEditorPage}>
            <iframe src={`file://${projects[id].directory}/index.html`} className={styles.projectIFrame} name="editorFrame" id="editorFrame" onLoad={() => InjectJS()}></iframe>
          </div>
        </div>
      ];
      editorName = "Layout editor";
      wideVersion = true;
    } else if (state.matches("editor.image")) {
      editingMenu = [
        <div key="image" className={styles.imageEditor}>
          <img src={state.context.image} className={styles.imageEditorImage} />
        </div>
      ];
      editorName = "Image viewer: " + editorTabs[editorTab].name;
    } else {
      editingMenu = [];
      if(editorTabs[editorTab] !== undefined) {
        editorName = "Code editor: " + editorTabs[editorTab].name;
      }
    }

    const settingsSelected = (editorTab === -1 ? styles.selectedSelection : "");
    const layoutEditorSelected = (editorTab === -2 ? styles.selectedSelection : "");

    const tabsTabSelected = state.matches("editor.layout.selectionTab") ? styles.selectedTabSelectorItem : "";
    const siteTabSelected = state.matches("editor.layout.creatorTab") ? styles.selectedTabSelectorItem : "";

    let tabSelector = editorTab === -2 ? 
      <div key="tabs" className={styles.tabSelector}>
        <div className={styles.tabSelectorItem + " " + tabsTabSelected} onClick={() => send("selectionTab")}>Tabs</div>
        <div className={styles.tabSelectorItem + " " + siteTabSelected} onClick={() => send("creatorTab")}>Site creator</div>
      </div>
    : null;

    let selectionPane = [
      tabSelector,
      <div key="settings" className={styles.editorSelection + " " + settingsSelected} onClick={() => selectTab(-1)}>
        <i className={"fas fa-gear " + styles.editorSelectionIcon}></i>
        Settings
      </div>,
      <div key="layout" className={styles.editorSelection + " " + layoutEditorSelected} onClick={() => selectTab(-2)}>
        <i className={"fas fa-table " + styles.editorSelectionIcon}></i>
        Layout editor
      </div>
    ];

    // Make selection pane expand and have tabs for pane and layout

    for(let i = 0; i < editorTabs.length; i++) {
      let selected = (i === editorTab ? styles.selectedSelection : "");
      
      let icon = null;
      let clickFunction = null;

      if(editorTabs[i].window !== false) {
        icon = <i className={"fas fa-arrow-up-right-from-square " + styles.editorSelectionIcon}></i>;
        clickFunction = () => {
          focusWindow(editorTabs[i].window);
        }
      } else {
        icon = <i className={"fas fa-angle-right " + styles.editorSelectionIcon}></i>;
        clickFunction = () => {
          selectTab(i);
        };
      }

      selectionPane.push(
        <div key={i} className={styles.editorSelection + " " + selected} onClick={() => clickFunction()}>
          {icon}
          {editorTabs[i].name}
        </div>
      );
    }

    selectionPane = !state.matches("editor.layout.creatorTab") ? selectionPane : [
      tabSelector,
      <span key="creator">Test</span>
    ];
    
    props.settitle([
      <span key="left" className="leftText">Bad CMS for Devs</span>,
      <span key="center" className="centerText">{editorName}</span>,
      <span key="right" className="rightText">Editing "{projects[id].name}"</span>
    ]);

    return (
        // Actual JSX of the dsahboard
        <div className={wideVersion ? styles.widePane : ''}>
            <div className={styles.editorContainer}>
              <div className={styles.editorOptions}>
                <i className={"fa-solid fa-arrow-left " + styles.leaveIcon} onClick={() => navigate("/Dashboard")}></i>
                {/* <span className={styles.editorOptionsName}>{editorName}</span> */}
                {/* <i className={"fa-solid fa-arrow-up-right-from-square " + styles.editorOptionsIcon} onClick={() => {popOut()}}></i> */}
                <i className={"fa-solid fa-arrow-up-right-from-square " + styles.editorOptionsIcon} onClick={() => { popOut() }}></i>
              </div>
              { editingMenu }
              { editorPane /* Although this seems like a wierd way to do this, I can't find another way to fix some wierd monaco bugs */}
            </div>
            <div className={styles.paneSelector}>
              {/* {finalSelections} */}
              { selectionPane }
            </div>
            {/* {deleteProjectElement} */}
        </div>
    );
}

//load monaco editor from node_modules
function ensureFirstBackSlash(str) {
    return str.length > 0 && str.charAt(0) !== "/"
        ? "/" + str
        : str;
}

function uriFromPath(_path) {
    const pathName = path.resolve(_path).replace(/\\/g, "/");
    return encodeURI("file://" + ensureFirstBackSlash(pathName));
}

loader.config({
  paths: {
    vs: uriFromPath(
      path.join(__dirname, "../node_modules/monaco-editor/min/vs")
    )
  }
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}