const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js')

const brandColor = 0x2b2d31
const successColor = 0x57f287
const errorColor = 0xed4245

function buildContainer(color, title, description, linkButton, thumbnailUrl) {
    const container = new ContainerBuilder().setAccentColor(color)
    const text = new TextDisplayBuilder().setContent(`**${title}**\n${description}`)

    if (thumbnailUrl) {
        container.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(text)
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl))
        )
    } else {
        container.addTextDisplayComponents(text)
    }

    if (linkButton) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel(linkButton.label)
                .setURL(linkButton.url)
                .setStyle(ButtonStyle.Link)
        )
        container.addActionRowComponents(row)
    }

    return container
}

function successContainer(title, description, linkButton, thumbnailUrl) {
    return buildContainer(successColor, title, description, linkButton, thumbnailUrl)
}

function errorContainer(title, description) {
    return buildContainer(errorColor, title, description)
}

function infoContainer(title, description, linkButton) {
    return buildContainer(brandColor, title, description, linkButton)
}

function plainContainer(content) {
    return new ContainerBuilder()
        .setAccentColor(brandColor)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(content)
        )
}

module.exports = { successContainer, errorContainer, infoContainer, plainContainer, ComponentsV2Flags: MessageFlags.IsComponentsV2 }
