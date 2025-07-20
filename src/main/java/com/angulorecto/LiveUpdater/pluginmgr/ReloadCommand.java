package com.angulorecto.LiveUpdater.pluginmgr;

import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.InvalidPluginException;
import org.bukkit.plugin.InvalidDescriptionException;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.File;

public class ReloadCommand implements CommandExecutor {
    private final SimplePluginManager pluginManager;

    public ReloadCommand(JavaPlugin loader) {
        this.pluginManager = new SimplePluginManager(loader);
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (args.length != 1) {
            sender.sendMessage(ChatColor.RED + "Usage: /reloadplugin <plugin-name>");
            return true;
        }

        String pluginName = args[0];
        Plugin targetPlugin = pluginManager.getPluginByName(pluginName);
        pluginManager.reload(targetPlugin);

        return true;
    }
}