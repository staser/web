import { WebDirective } from './../../types';
import { isDesktopApplication, isNullOrUndefined } from '@/utils';
import template from '%/directives/account-menu.pug';
import { ProtectedAction, ContentType } from 'snjs';
import { PureViewCtrl } from '@Views/abstract/pure_view_ctrl';
import {
  STRING_ACCOUNT_MENU_UNCHECK_MERGE,
  STRING_SIGN_OUT_CONFIRMATION,
  STRING_E2E_ENABLED,
  STRING_LOCAL_ENC_ENABLED,
  STRING_ENC_NOT_ENABLED,
  STRING_IMPORT_SUCCESS,
  STRING_REMOVE_PASSCODE_CONFIRMATION,
  STRING_REMOVE_PASSCODE_OFFLINE_ADDENDUM,
  STRING_NON_MATCHING_PASSCODES,
  STRING_NON_MATCHING_PASSWORDS,
  STRING_INVALID_IMPORT_FILE,
  STRING_GENERATING_LOGIN_KEYS,
  STRING_GENERATING_REGISTER_KEYS,
  StringImportError
} from '@/strings';
import { SyncOpStatus } from '@node_modules/snjs/dist/@types/services/sync/sync_op_status';
import { PasswordWizardType } from '@/types';
import { BackupFile } from '@node_modules/snjs/dist/@types/services/protocol_service';

const ELEMENT_ID_IMPORT_PASSWORD_INPUT = 'import-password-request';

const ELEMENT_NAME_AUTH_EMAIL = 'email';
const ELEMENT_NAME_AUTH_PASSWORD = 'password';
const ELEMENT_NAME_AUTH_PASSWORD_CONF = 'password_conf';

type FormData = {
  email: string
  user_password: string
  password_conf: string
  confirmPassword: boolean
  showLogin: boolean
  showRegister: boolean
  showPasscodeForm: boolean
  strictSignin?: boolean
  ephemeral: boolean
  mfa: { payload: any }
  userMfaCode?: string
  mergeLocal?: boolean
  url: string
  authenticating: boolean
  status: string
  passcode: string
  confirmPasscode: string
  changingPasscode: boolean
}

type AccountMenuState = {
  formData: Partial<FormData>
  appVersion: string
  passcodeAutoLockOptions: any
  user: any
  mutable: any
  importData: any
}

class AccountMenuCtrl extends PureViewCtrl {

  public appVersion: string
  private syncStatus?: SyncOpStatus
  private closeFunction?: () => void

  /* @ngInject */
  constructor(
    $timeout: ng.ITimeoutService,
    appVersion: string,
  ) {
    super($timeout);
    this.appVersion = appVersion;
  }

  /** @override */
  getInitialState() {
    return {
      appVersion: 'v' + ((window as any).electronAppVersion || this.appVersion),
      passcodeAutoLockOptions: this.application!.getLockService().getAutoLockIntervalOptions(),
      user: this.application!.getUser(),
      formData: {
        mergeLocal: true,
        ephemeral: false
      },
      mutable: {}
    } as AccountMenuState;
  }

  getState() {
    return this.state as AccountMenuState;
  }

  async onAppKeyChange() {
    super.onAppKeyChange();
    this.setState(this.refreshedCredentialState());
  }

  async onAppLaunch() {
    super.onAppLaunch();
    this.setState(this.refreshedCredentialState());
    this.loadHost();
    this.reloadAutoLockInterval();
    this.loadBackupsAvailability();
  }

  refreshedCredentialState() {
    return {
      user: this.application!.getUser(),
      canAddPasscode: !this.application!.isEphemeralSession(),
      hasPasscode: this.application!.hasPasscode(),
      showPasscodeForm: false
    };
  }

  $onInit() {
    super.$onInit();
    this.initProps({
      closeFunction: this.closeFunction
    });
    this.syncStatus = this.application!.getSyncStatus();
  }

  close() {
    this.$timeout(() => {
      this.props.closeFunction();
    });
  }

  async loadHost() {
    const host = await this.application!.getHost();
    this.setState({
      server: host,
      formData: {
        ...this.getState().formData,
        url: host
      }
    });
  }

  onHostInputChange() {
    const url = this.getState().formData.url!;
    this.application!.setHost(url);
  }

  async loadBackupsAvailability() {
    const hasUser = !isNullOrUndefined(this.application!.getUser());
    const hasPasscode = this.application!.hasPasscode();
    const encryptedAvailable = hasUser || hasPasscode;

    function encryptionStatusString() {
      if (hasUser) {
        return STRING_E2E_ENABLED;
      } else if (hasPasscode) {
        return STRING_LOCAL_ENC_ENABLED;
      } else {
        return STRING_ENC_NOT_ENABLED;
      }
    }

    this.setState({
      encryptionStatusString: encryptionStatusString(),
      encryptionEnabled: encryptedAvailable,
      mutable: {
        ...this.getState().mutable,
        backupEncrypted: encryptedAvailable
      }
    });
  }

  submitMfaForm() {
    this.login();
  }

  blurAuthFields() {
    const names = [
      ELEMENT_NAME_AUTH_EMAIL,
      ELEMENT_NAME_AUTH_PASSWORD,
      ELEMENT_NAME_AUTH_PASSWORD_CONF
    ];
    for (const name of names) {
      const element = document.getElementsByName(name)[0];
      if (element) {
        element.blur();
      }
    }
  }

  submitAuthForm() {
    if (!this.getState().formData.email || !this.getState().formData.user_password) {
      return;
    }
    this.blurAuthFields();
    if (this.getState().formData.showLogin) {
      this.login();
    } else {
      this.register();
    }
  }

  async setFormDataState(formData: Partial<FormData>) {
    return this.setState({
      formData: {
        ...this.getState().formData,
        ...formData
      }
    });
  }

  async login() {
    await this.setFormDataState({
      status: STRING_GENERATING_LOGIN_KEYS,
      authenticating: true
    });
    const formData = this.getState().formData;
    const response = await this.application!.signIn(
      formData.email!,
      formData.user_password!,
      formData.strictSignin,
      formData.ephemeral,
      formData.mfa && formData.mfa.payload.mfa_key,
      formData.userMfaCode,
      formData.mergeLocal
    );
    const hasError = !response || response.error;
    if (!hasError) {
      await this.setFormDataState({
        authenticating: false,
        user_password: undefined
      });
      this.close();
      return;
    }
    const error = response
      ? response.error
      : { message: "An unknown error occured." };
    if (error.tag === 'mfa-required' || error.tag === 'mfa-invalid') {
      await this.setFormDataState({
        showLogin: false,
        mfa: error,
        status: undefined
      });
    } else {
      await this.setFormDataState({
        showLogin: true,
        mfa: undefined,
        status: undefined,
        user_password: undefined
      });
      if (error.message) {
        this.application!.alertService!.alert(error.message);
      }
    }
    await this.setFormDataState({
      authenticating: false
    });
  }

  async register() {
    const confirmation = this.getState().formData.password_conf;
    if (confirmation !== this.getState().formData.user_password) {
      this.application!.alertService!.alert(
        STRING_NON_MATCHING_PASSWORDS
      );
      return;
    }
    await this.setFormDataState({
      confirmPassword: false,
      status: STRING_GENERATING_REGISTER_KEYS,
      authenticating: true
    });
    const response = await this.application!.register(
      this.getState().formData.email!,
      this.getState().formData.user_password!,
      this.getState().formData.ephemeral,
      this.getState().formData.mergeLocal
    );
    if (!response || response.error) {
      await this.setFormDataState({
        status: undefined
      });
      const error = response
        ? response.error
        : { message: "An unknown error occured." };
      await this.setFormDataState({
        authenticating: false
      });
      this.application!.alertService!.alert(
        error.message
      );
    } else {
      await this.setFormDataState({ authenticating: false });
      this.close();
    }
  }

  mergeLocalChanged() {
    if (!this.getState().formData.mergeLocal) {
      this.application!.alertService!.confirm(
        STRING_ACCOUNT_MENU_UNCHECK_MERGE,
        undefined,
        undefined,
        undefined,
        undefined,
        () => {
          this.setFormDataState({
            mergeLocal: true
          });
        },
        true,
      );
    }
  }

  openPasswordWizard() {
    this.close();
    this.application!.presentPasswordWizard(PasswordWizardType.ChangePassword);
  }

  async openPrivilegesModal() {
    const run = () => {
      this.application!.presentPrivilegesManagementModal();
      this.close();
    };
    const needsPrivilege = await this.application!.privilegesService!.actionRequiresPrivilege(
      ProtectedAction.ManagePrivileges
    );
    if (needsPrivilege) {
      this.application!.presentPrivilegesModal(
        ProtectedAction.ManagePrivileges,
        () => {
          run();
        }
      );
    } else {
      run();
    }
  }

  destroyLocalData() {
    this.application!.alertService!.confirm(
      STRING_SIGN_OUT_CONFIRMATION,
      undefined,
      undefined,
      undefined,
      async () => {
        await this.application!.signOut();
      },
      undefined,
      true,
    );
  }

  async submitImportPassword() {
    await this.performImport(
      this.getState().importData.data,
      this.getState().importData.password
    );
  }

  async readFile(file: File): Promise<any> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target!.result as string);
          resolve(data);
        } catch (e) {
          this.application!.alertService!.alert(
            STRING_INVALID_IMPORT_FILE
          );
        }
      };
      reader.readAsText(file);
    });
  }

  /**
   * @template 
   */
  async importFileSelected(files: File[]) {
    const run = async () => {
      const file = files[0];
      const data = await this.readFile(file);
      if (!data) {
        return;
      }
      if (data.auth_params) {
        await this.setState({
          importData: {
            ...this.getState().importData,
            requestPassword: true,
            data: data
          }
        });
        const element = document.getElementById(
          ELEMENT_ID_IMPORT_PASSWORD_INPUT
        );
        if (element) {
          element.scrollIntoView(false);
        }
      } else {
        await this.performImport(data, undefined);
      }
    };
    const needsPrivilege = await this.application!.privilegesService!.actionRequiresPrivilege(
      ProtectedAction.ManageBackups
    );
    if (needsPrivilege) {
      this.application!.presentPrivilegesModal(
        ProtectedAction.ManageBackups,
        run
      );
    } else {
      run();
    }
  }

  async performImport(data: BackupFile, password?: string) {
    await this.setState({
      importData: {
        ...this.getState().importData,
        loading: true
      }
    });
    const errorCount = await this.importJSONData(data, password);
    this.setState({
      importData: null
    });
    if (errorCount > 0) {
      const message = StringImportError(errorCount);
      this.application!.alertService!.alert(
        message
      );
    } else {
      this.application!.alertService!.alert(
        STRING_IMPORT_SUCCESS
      );
    }
  }

  async importJSONData(data: BackupFile, password?: string) {
    const { errorCount } = await this.application!.importData(
      data,
      password
    );
    return errorCount;
  }

  async downloadDataArchive() {
    this.application!.getArchiveService().downloadBackup(this.getState().mutable.backupEncrypted);
  }

  notesAndTagsCount() {
    return this.application!.getItems(
      [
        ContentType.Note,
        ContentType.Tag
      ]
    ).length;
  }

  encryptionStatusForNotes() {
    const length = this.notesAndTagsCount();
    return length + "/" + length + " notes and tags encrypted";
  }

  async reloadAutoLockInterval() {
    const interval = await this.application!.getLockService().getAutoLockInterval();
    this.setState({
      selectedAutoLockInterval: interval
    });
  }

  async selectAutoLockInterval(interval: number) {
    const run = async () => {
      await this.application!.getLockService().setAutoLockInterval(interval);
      this.reloadAutoLockInterval();
    };
    const needsPrivilege = await this.application!.privilegesService!.actionRequiresPrivilege(
      ProtectedAction.ManagePasscode
    );
    if (needsPrivilege) {
      this.application!.presentPrivilegesModal(
        ProtectedAction.ManagePasscode,
        () => {
          run();
        }
      );
    } else {
      run();
    }
  }

  hidePasswordForm() {
    this.setFormDataState({
      showLogin: false,
      showRegister: false,
      user_password: undefined,
      password_conf: undefined
    });
  }

  hasPasscode() {
    return this.application!.hasPasscode();
  }

  addPasscodeClicked() {
    this.setFormDataState({
      showPasscodeForm: true
    });
  }

  submitPasscodeForm() {
    const passcode = this.getState().formData.passcode!;
    if (passcode !== this.getState().formData.confirmPasscode!) {
      this.application!.alertService!.alert(
        STRING_NON_MATCHING_PASSCODES
      );
      return;
    }
    (this.getState().formData.changingPasscode
      ? this.application!.changePasscode(passcode)
      : this.application!.setPasscode(passcode)
    ).then(() => {
      this.setFormDataState({
        passcode: undefined,
        confirmPasscode: undefined,
        showPasscodeForm: false
      });
    });
  }

  async changePasscodePressed() {
    const run = () => {
      this.getState().formData.changingPasscode = true;
      this.addPasscodeClicked();
    };
    const needsPrivilege = await this.application!.privilegesService!.actionRequiresPrivilege(
      ProtectedAction.ManagePasscode
    );
    if (needsPrivilege) {
      this.application!.presentPrivilegesModal(
        ProtectedAction.ManagePasscode,
        run
      );
    } else {
      run();
    }
  }

  async removePasscodePressed() {
    const run = async () => {
      const signedIn = !isNullOrUndefined(await this.application!.getUser());
      let message = STRING_REMOVE_PASSCODE_CONFIRMATION;
      if (!signedIn) {
        message += STRING_REMOVE_PASSCODE_OFFLINE_ADDENDUM;
      }
      this.application!.alertService!.confirm(
        message,
        undefined,
        undefined,
        undefined,
        () => {
          this.application!.removePasscode();
        },
        undefined,
        true,
      );
    };
    const needsPrivilege = await this.application!.privilegesService!.actionRequiresPrivilege(
      ProtectedAction.ManagePasscode
    );
    if (needsPrivilege) {
      this.application!.presentPrivilegesModal(
        ProtectedAction.ManagePasscode,
        run
      );
    } else {
      run();
    }
  }

  isDesktopApplication() {
    return isDesktopApplication();
  }
}

export class AccountMenu extends WebDirective {
  constructor() {
    super();
    this.restrict = 'E';
    this.template = template;
    this.controller = AccountMenuCtrl;
    this.controllerAs = 'self';
    this.bindToController = true;
    this.scope = {
      closeFunction: '&',
      application: '='
    };
  }
}
